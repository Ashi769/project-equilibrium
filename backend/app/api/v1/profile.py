from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.models.psychometric import PsychometricProfile, AnalysisStatus
from app.schemas.profile import ProfileResponse, ProfileUpdateRequest

router = APIRouter(prefix="/profile", tags=["profile"])


def _build_profile_response(
    user: User, profile: PsychometricProfile | None
) -> ProfileResponse:
    reinterview_due = False
    reinterview_due_at = None
    if profile and profile.reinterview_due_at:
        reinterview_due_at = profile.reinterview_due_at
        reinterview_due = datetime.now(timezone.utc) >= profile.reinterview_due_at

    return ProfileResponse(
        id=user.id,
        name=user.name,
        email=user.email,
        age=user.age,
        gender=user.gender,
        height=user.height,
        drinking=user.drinking,
        smoking=user.smoking,
        religion=user.religion,
        food_preference=user.food_preference,
        analysis_status=profile.analysis_status if profile else None,
        hard_filters=user.hard_filters or {},
        reinterview_due=reinterview_due,
        reinterview_due_at=reinterview_due_at,
    )


@router.get("", response_model=ProfileResponse)
async def get_profile(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(PsychometricProfile).where(
            PsychometricProfile.user_id == current_user.id
        )
    )
    profile = result.scalar_one_or_none()
    return _build_profile_response(current_user, profile)


@router.patch("", response_model=ProfileResponse)
async def update_profile(
    body: ProfileUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if body.hard_filters is not None:
        current_user.hard_filters = body.hard_filters.model_dump(exclude_none=False)

    if body.attributes is not None:
        attrs = body.attributes.model_dump(exclude_none=True)
        for key, value in attrs.items():
            setattr(current_user, key, value)
        db.add(current_user)

    await db.commit()
    await db.refresh(current_user)

    result = await db.execute(
        select(PsychometricProfile).where(
            PsychometricProfile.user_id == current_user.id
        )
    )
    profile = result.scalar_one_or_none()
    return _build_profile_response(current_user, profile)


@router.get("/analysis-status")
async def analysis_status(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(PsychometricProfile).where(
            PsychometricProfile.user_id == current_user.id
        )
    )
    profile = result.scalar_one_or_none()
    if not profile:
        return {"analysis_status": "pending"}

    if (
        profile.analysis_status == AnalysisStatus.failed
        and profile.identity_vector is not None
    ):
        profile.analysis_status = AnalysisStatus.complete
        await db.commit()

    return {"analysis_status": profile.analysis_status}
