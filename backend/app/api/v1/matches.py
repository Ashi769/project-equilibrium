from fastapi import APIRouter, Depends, HTTPException
from typing import Annotated
from fastapi import Header
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from sqlalchemy.orm import joinedload

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.config import settings
from app.models.user import User
from app.models.match import Match
from app.models.schedule import Meeting, MeetingStatus
from app.schemas.matches import MatchSummary, MatchDetail
from app.services.matching_service import get_match_detail, MAX_VISIBLE_MATCHES, TOP_N

router = APIRouter(prefix="/matches", tags=["matches"])


@router.get("", response_model=list[MatchSummary])
async def list_matches(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Active meetings (proposed + confirmed) consume slots from the same 5-connection cap.
    # Someone you're already meeting with was removed from the match cache when the
    # meeting was proposed, so they won't appear here — but their slot is still occupied.
    active_meeting_count = (await db.execute(
        select(func.count())
        .select_from(Meeting)
        .where(
            or_(
                Meeting.proposer_id == current_user.id,
                Meeting.match_id == current_user.id,
            ),
            Meeting.status.in_([MeetingStatus.proposed, MeetingStatus.confirmed]),
        )
    )).scalar() or 0

    remaining_slots = max(0, MAX_VISIBLE_MATCHES - active_meeting_count)
    if remaining_slots == 0:
        return []

    # Fetch the full cached pool — discovery selection needs positions beyond remaining_slots
    result = await db.execute(
        select(Match)
        .where(Match.user_id == current_user.id)
        .order_by(Match.compatibility_score.desc())
        .limit(TOP_N)
    )
    caches = result.scalars().all()

    if not caches:
        return []

    matched_ids = [c.matched_user_id for c in caches]
    user_result = await db.execute(
        select(User)
        .where(User.id.in_(matched_ids))
        .options(joinedload(User.psychometric_profile))
    )
    users_by_id = {u.id: u for u in user_result.scalars().all()}

    from app.schemas.matches import DimensionScore

    # Build (cache, summary) pairs preserving pool order (score desc)
    pairs: list[tuple[Match, MatchSummary]] = []
    for cache in caches:
        user = users_by_id.get(cache.matched_user_id)
        if not user:
            continue
        pairs.append((
            cache,
            MatchSummary(
                id=user.id,
                name=user.name,
                age=user.age,
                compatibility_score=cache.compatibility_score,
                top_dimensions=[DimensionScore(**d) for d in cache.dimension_scores],
            ),
        ))

    # Fewer pairs than available slots — return all, no split needed
    if len(pairs) <= remaining_slots:
        return [s for _, s in pairs]

    # Always reserve 1 slot for discovery when we have room for at least 2.
    # Core: top (remaining_slots - 1) by score.
    # Discovery: from the rest of the pool, whoever has waited longest (oldest first_matched_at).
    if remaining_slots < 2:
        return [s for _, s in pairs[:remaining_slots]]

    core = [s for _, s in pairs[: remaining_slots - 1]]
    candidate_pool = pairs[remaining_slots - 1 :]
    _, discovery_summary = min(candidate_pool, key=lambda p: p[0].first_matched_at)

    return core + [discovery_summary]


@router.get("/{match_user_id}", response_model=MatchDetail)
async def get_match(
    match_user_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    detail = await get_match_detail(current_user, match_user_id, db)
    if not detail:
        raise HTTPException(status_code=404, detail="Match not found")
    return detail


@router.post("/refresh")
async def refresh_matches(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    x_admin_token: Annotated[str | None, Header()] = None,
):
    if x_admin_token != settings.debug_api_token:
        raise HTTPException(status_code=403, detail="Admin access required")
    from app.services.matching_service import compute_and_cache_matches
    from app.models.psychometric import PsychometricProfile, AnalysisStatus

    profile_result = await db.execute(
        select(PsychometricProfile).where(PsychometricProfile.user_id == current_user.id)
    )
    profile = profile_result.scalar_one_or_none()
    if not profile or profile.analysis_status != AnalysisStatus.complete:
        raise HTTPException(status_code=400, detail="Profile not ready for matching")

    matches = await compute_and_cache_matches(current_user, db)
    current_user.last_matched_at = datetime.now(timezone.utc)
    await db.commit()

    return {"matches": len(matches)}
