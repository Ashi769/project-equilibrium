from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

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
