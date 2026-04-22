from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.schemas.matches import MatchSummary, MatchDetail
from app.services.matching_service import get_matches, get_match_detail

router = APIRouter(prefix="/matches", tags=["matches"])


@router.get("", response_model=list[MatchSummary])
async def list_matches(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await get_matches(current_user, db)


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
):
    from app.models.psychometric import PsychometricProfile, AnalysisStatus

    result = await db.execute(
        select(PsychometricProfile).where(
            PsychometricProfile.user_id == current_user.id
        )
    )
    profile = result.scalar_one_or_none()

    if not profile or profile.analysis_status != AnalysisStatus.complete:
        raise HTTPException(status_code=400, detail="Profile not ready for matching")

    matches = await get_matches(current_user, db)
    return {"matches": len(matches)}
