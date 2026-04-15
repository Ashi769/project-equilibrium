"""
Celery task: process an interview transcript after it's completed.
Pipeline: decrypt → anonymize → Gemini analysis → embed → store vectors
"""
import asyncio
from datetime import datetime, timezone

from app.workers.celery_app import celery_app
from app.core.config import settings


@celery_app.task(bind=True, max_retries=3, default_retry_delay=30)
def process_interview_transcript(self, session_id: str):
    """Run the full post-interview analysis pipeline."""
    try:
        asyncio.run(_run_pipeline(session_id))
    except Exception as exc:
        raise self.retry(exc=exc)


async def _run_pipeline(session_id: str):
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
    from sqlalchemy import select
    from app.models.interview import InterviewSession, ProcessingStatus
    from app.models.psychometric import PsychometricProfile, AnalysisStatus
    from app.core.encryption import decrypt_json
    from app.services.anonymizer import anonymize
    from app.services.analysis_service import analyze_transcript
    from app.services.embedding_service import embed_batch

    engine = create_async_engine(settings.database_url, echo=False)
    Session = async_sessionmaker(engine, expire_on_commit=False)

    async with Session() as db:
        # 1. Fetch session
        result = await db.execute(
            select(InterviewSession).where(InterviewSession.id == session_id)
        )
        session = result.scalar_one_or_none()
        if not session or not session.transcript_encrypted:
            return

        # Mark processing
        session.processing_status = ProcessingStatus.processing
        profile_result = await db.execute(
            select(PsychometricProfile).where(PsychometricProfile.user_id == session.user_id)
        )
        profile = profile_result.scalar_one_or_none()
        if profile:
            profile.analysis_status = AnalysisStatus.processing
        await db.commit()

        try:
            # 2. Decrypt transcript
            transcript = decrypt_json(session.transcript_encrypted)

            # 3. Anonymize each message
            anon_transcript = [
                {"role": m["role"], "content": anonymize(m["content"])}
                for m in transcript
            ]

            # 4. Gemini analysis
            analysis = await analyze_transcript(anon_transcript)

            # 5. Generate embeddings
            identity_summary = analysis.get("identity_summary", "")
            aspiration_summary = analysis.get("aspiration_summary", "")
            vectors = embed_batch([identity_summary, aspiration_summary])
            identity_vector, aspiration_vector = vectors[0], vectors[1]

            # 6. Update profile
            if not profile:
                profile = PsychometricProfile(user_id=session.user_id)
                db.add(profile)

            profile.ocean_scores = analysis.get("ocean_scores")
            profile.attachment_style = analysis.get("attachment_style")
            profile.values_profile = analysis.get("values_profile")
            profile.effort_score = analysis.get("effort_score")
            profile.identity_vector = identity_vector
            profile.aspiration_vector = aspiration_vector
            profile.analysis_status = AnalysisStatus.complete
            profile.updated_at = datetime.now(timezone.utc)

            session.processing_status = ProcessingStatus.complete
            session.completed_at = datetime.now(timezone.utc)

        except Exception as exc:
            session.processing_status = ProcessingStatus.failed
            if profile:
                profile.analysis_status = AnalysisStatus.failed
            await db.commit()
            raise exc

        await db.commit()

    await engine.dispose()
