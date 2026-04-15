from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.models.psychometric import PsychometricProfile
from app.schemas.profile import ProfileResponse, ProfileUpdateRequest

router = APIRouter(prefix="/profile", tags=["profile"])


@router.get("", response_model=ProfileResponse)
async def get_profile(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(PsychometricProfile).where(PsychometricProfile.user_id == current_user.id)
    )
    profile = result.scalar_one_or_none()

    return ProfileResponse(
        id=current_user.id,
        name=current_user.name,
        email=current_user.email,
        age=current_user.age,
        gender=current_user.gender,
        analysis_status=profile.analysis_status if profile else None,
        hard_filters=current_user.hard_filters or {},
    )


@router.patch("", response_model=ProfileResponse)
async def update_profile(
    body: ProfileUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if body.hard_filters is not None:
        current_user.hard_filters = body.hard_filters.model_dump(exclude_none=False)

    result = await db.execute(
        select(PsychometricProfile).where(PsychometricProfile.user_id == current_user.id)
    )
    profile = result.scalar_one_or_none()

    return ProfileResponse(
        id=current_user.id,
        name=current_user.name,
        email=current_user.email,
        age=current_user.age,
        gender=current_user.gender,
        analysis_status=profile.analysis_status if profile else None,
        hard_filters=current_user.hard_filters or {},
    )


@router.get("/analysis-status")
async def analysis_status(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(PsychometricProfile).where(PsychometricProfile.user_id == current_user.id)
    )
    profile = result.scalar_one_or_none()
    return {"status": profile.analysis_status if profile else "pending"}
