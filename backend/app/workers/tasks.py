"""
Celery task: process an interview transcript after it's completed.
Pipeline: decrypt → anonymize → Gemini analysis → embed → store vectors
"""

import asyncio
from datetime import datetime, timezone, timedelta

from celery import shared_task
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

    engine = create_async_engine(settings.async_database_url, echo=False)
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

    engine = create_async_engine(settings.async_database_url, echo=False)
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
            select(PsychometricProfile).where(
                PsychometricProfile.user_id == session.user_id
            )
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
                    AnalysisStatus.complete
                    if has_previous_data
                    else AnalysisStatus.failed
                )
            await db.commit()
            raise exc

        await db.commit()

        # Immediately compute matches so the user sees results without waiting for the nightly job
        try:
            from app.models.user import User
            from app.services.matching_service import compute_and_cache_matches

            user_result = await db.execute(select(User).where(User.id == session.user_id))
            user = user_result.scalar_one_or_none()
            if user:
                await compute_and_cache_matches(user, db)
                user.last_matched_at = datetime.now(timezone.utc)
                await db.commit()
        except Exception:
            pass  # matching failure must not roll back the completed analysis

    await engine.dispose()


@celery_app.task(bind=True, max_retries=3, default_retry_delay=300)
def refresh_daily_matches(self):
    """Refresh match cache for all eligible users."""
    try:
        asyncio.run(_refresh_daily_matches())
    except Exception as exc:
        raise self.retry(exc=exc)


MATCH_BATCH_SIZE = 100


async def _refresh_daily_matches():
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
    from sqlalchemy import select, and_
    from app.models.psychometric import PsychometricProfile, AnalysisStatus
    from app.models.user import User
    from app.services.matching_service import compute_and_cache_matches

    engine = create_async_engine(settings.async_database_url, echo=False)
    Session = async_sessionmaker(engine, expire_on_commit=False)

    # Fetch only IDs up front — cheap, bounds initial memory regardless of user count
    async with Session() as db:
        yesterday = datetime.now(timezone.utc) - timedelta(days=1)
        id_result = await db.execute(
            select(User.id)
            .join(PsychometricProfile, PsychometricProfile.user_id == User.id)
            .where(
                and_(
                    PsychometricProfile.analysis_status == AnalysisStatus.complete,
                    PsychometricProfile.identity_vector.is_not(None),
                    User.last_matched_at.is_(None)
                    | (User.last_matched_at < yesterday),
                )
            )
        )
        user_ids = [row[0] for row in id_result.all()]

    # Process in batches with a fresh session per batch so the identity map
    # never grows beyond MATCH_BATCH_SIZE users worth of objects
    for i in range(0, len(user_ids), MATCH_BATCH_SIZE):
        batch_ids = user_ids[i : i + MATCH_BATCH_SIZE]
        async with Session() as db:
            user_result = await db.execute(
                select(User).where(User.id.in_(batch_ids))
            )
            users = user_result.scalars().all()
            for user in users:
                try:
                    await compute_and_cache_matches(user, db)
                    user.last_matched_at = datetime.now(timezone.utc)
                except Exception:
                    pass
            await db.commit()

    await _run_rescue_pass(Session)
    await engine.dispose()


async def _run_rescue_pass(Session) -> None:
    """Guarantee every user with a complete profile appears in at least RESCUE_MIN_FLOOR pools.

    Runs after the main nightly batch so all pools are settled before we check
    who was left out. Two outcomes for a stranded user:
      - hard_filter_candidates == 0 → preferences are infeasible, flag for human review
      - hard_filter_candidates  > 0 → inject into the best compatible hosts we can find
    """
    import uuid
    from sqlalchemy import select, and_, delete
    from sqlalchemy.dialects.postgresql import insert as pg_insert
    from app.models.match import Match
    from app.models.user import User
    from app.models.psychometric import PsychometricProfile, AnalysisStatus
    from app.services.matching_service import (
        count_hard_filter_candidates,
        get_matches,
        TOP_N,
        RESCUE_MIN_FLOOR,
        RESCUE_SCORE_FLOOR,
    )

    # Find users with complete profiles that don't appear in any match pool
    async with Session() as db:
        exposed_subq = select(Match.matched_user_id).distinct().scalar_subquery()
        result = await db.execute(
            select(User.id)
            .join(PsychometricProfile, PsychometricProfile.user_id == User.id)
            .where(
                PsychometricProfile.analysis_status == AnalysisStatus.complete,
                PsychometricProfile.identity_vector.is_not(None),
                User.id.not_in(exposed_subq),
            )
        )
        stranded_ids = [row[0] for row in result.all()]

    for user_id in stranded_ids:
        async with Session() as db:
            user_v = await db.get(User, user_id)
            if not user_v:
                continue

            candidate_count = await count_hard_filter_candidates(user_v, db)

            if candidate_count == 0:
                # Hard filters eliminate everyone — flag for human review
                user_v.rescue_flagged = True
                user_v.rescue_flagged_at = datetime.now(timezone.utc)
                await db.commit()
                continue

            # Get V's outbound matches — these are bidirectionally filter-verified hosts
            outbound = await get_matches(user_v, db)
            if not outbound:
                continue

            injection_count = 0
            now = datetime.now(timezone.utc)

            for host_match in outbound:
                if injection_count >= RESCUE_MIN_FLOOR:
                    break
                if host_match.compatibility_score < RESCUE_SCORE_FLOOR:
                    break

                # Skip if V is already in this host's cache
                already_cached = (await db.execute(
                    select(Match).where(
                        Match.user_id == host_match.id,
                        Match.matched_user_id == user_v.id,
                    )
                )).scalar_one_or_none()
                if already_cached:
                    injection_count += 1
                    continue

                # Check host's cache capacity
                host_caches = (await db.execute(
                    select(Match)
                    .where(Match.user_id == host_match.id)
                    .order_by(Match.compatibility_score.asc())
                )).scalars().all()

                evict_id = None
                if len(host_caches) < TOP_N:
                    pass  # room available
                elif host_caches[0].compatibility_score < host_match.compatibility_score:
                    evict_id = host_caches[0].id
                else:
                    continue  # host's cache is full with better-scoring matches

                if evict_id:
                    await db.execute(delete(Match).where(Match.id == evict_id))

                await db.execute(
                    pg_insert(Match).values({
                        "id": str(uuid.uuid4()),
                        "user_id": host_match.id,
                        "matched_user_id": user_v.id,
                        "compatibility_score": host_match.compatibility_score,
                        "dimension_scores": [d.model_dump() for d in host_match.top_dimensions],
                        "computed_at": now,
                        "first_matched_at": now,
                    }).on_conflict_do_nothing()
                )
                await db.commit()
                injection_count += 1
