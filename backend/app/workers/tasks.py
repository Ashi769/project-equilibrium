"""
Celery task: process an interview transcript after it's completed.
Pipeline: decrypt → anonymize → Gemini analysis → embed → store vectors
"""
import asyncio
from datetime import datetime, timezone

from app.workers.celery_app import celery_app
from app.core.config import settings


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def score_user_photos(self, user_id: str):
    """Score uploaded photos and store SMV score on psychometric profile."""
    try:
        asyncio.run(_score_photos(user_id))
    except Exception as exc:
        raise self.retry(exc=exc)


async def _score_photos(user_id: str):
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
    from sqlalchemy import select
    from app.models.photo import UserPhoto
    from app.models.psychometric import PsychometricProfile
    from app.services.smv_service import score_photos
    from app.services.r2_service import download_photo

    engine = create_async_engine(settings.database_url, echo=False)
    Session = async_sessionmaker(engine, expire_on_commit=False)

    async with Session() as db:
        photo_result = await db.execute(
            select(UserPhoto).where(UserPhoto.user_id == user_id)
        )
        photos = photo_result.scalars().all()
        if not photos:
            return

        photo_data = []
        for p in photos[:5]:
            if p.r2_key:
                try:
                    photo_data.append(download_photo(p.r2_key))
                except Exception:
                    pass
        if not photo_data:
            return

        result = await score_photos(photo_data)

        profile_result = await db.execute(
            select(PsychometricProfile).where(PsychometricProfile.user_id == user_id)
        )
        profile = profile_result.scalar_one_or_none()
        if profile:
            profile.smv_score = result["score"]
            await db.commit()

    await engine.dispose()


@celery_app.task(bind=True, max_retries=3, default_retry_delay=30)
def process_interview_transcript(self, session_id: str):
    """Run the full post-interview analysis pipeline."""
    try:
        asyncio.run(_run_pipeline(session_id))
    except Exception as exc:
        # Back off longer on quota errors
        delay = 60 if ("429" in str(exc) or "RESOURCE_EXHAUSTED" in str(exc)) else 30
        raise self.retry(exc=exc, countdown=delay)


async def _run_pipeline(session_id: str):
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
    from sqlalchemy import select
    # UserPhoto must be imported before any model that relates to User,
    # otherwise SQLAlchemy mapper config fails resolving the relationship.
    from app.models.photo import UserPhoto  # noqa: F401
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

            # 5. Generate embeddings (identity, aspiration, communication style)
            identity_summary = analysis.get("identity_summary", "")
            aspiration_summary = analysis.get("aspiration_summary", "")
            communication_summary = analysis.get("communication_style_summary", "")
            texts_to_embed = [identity_summary, aspiration_summary]
            if communication_summary:
                texts_to_embed.append(communication_summary)
            vectors = embed_batch(texts_to_embed)
            identity_vector, aspiration_vector = vectors[0], vectors[1]
            communication_vector = vectors[2] if len(vectors) > 2 else None

            # 6. Update profile
            if not profile:
                profile = PsychometricProfile(user_id=session.user_id)
                db.add(profile)

            from dateutil.relativedelta import relativedelta

            profile.ocean_scores = analysis.get("ocean_scores")
            profile.attachment_style = analysis.get("attachment_style")
            profile.values_profile = analysis.get("values_profile")
            profile.effort_score = analysis.get("effort_score")
            profile.identity_vector = identity_vector
            profile.aspiration_vector = aspiration_vector
            profile.communication_vector = communication_vector
            profile.analysis_status = AnalysisStatus.complete
            profile.updated_at = datetime.now(timezone.utc)

            now = datetime.now(timezone.utc)
            profile.last_interview_at = now
            profile.reinterview_due_at = now + relativedelta(months=9)
            profile.reinterview_nudged = False

            session.processing_status = ProcessingStatus.complete
            session.completed_at = datetime.now(timezone.utc)

        except Exception as exc:
            session.processing_status = ProcessingStatus.failed
            if profile:
                has_previous_data = profile.identity_vector is not None
                profile.analysis_status = (
                    AnalysisStatus.complete if has_previous_data else AnalysisStatus.failed
                )
            await db.commit()
            raise exc

        await db.commit()

    await engine.dispose()
