from fastapi import APIRouter, Depends, HTTPException
from typing import Annotated
from fastapi import Header
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import joinedload

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.config import settings
from app.models.user import User
from app.models.match import Match
from app.schemas.matches import MatchSummary, MatchDetail
from app.services.matching_service import get_match_detail

router = APIRouter(prefix="/matches", tags=["matches"])


@router.get("", response_model=list[MatchSummary])
async def list_matches(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Match)
        .where(Match.user_id == current_user.id)
        .order_by(Match.compatibility_score.desc())
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

    matches = []
    for cache in caches:
        user = users_by_id.get(cache.matched_user_id)
        if not user:
            continue
        matches.append(
            MatchSummary(
                id=user.id,
                name=user.name,
                age=user.age,
                compatibility_score=cache.compatibility_score,
                top_dimensions=[DimensionScore(**d) for d in cache.dimension_scores],
            )
        )

    return matches


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
