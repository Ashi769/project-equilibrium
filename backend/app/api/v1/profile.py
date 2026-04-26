from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update as sql_update

from app.core.database import get_db
from app.core.deps import get_current_user, get_current_user_id
from app.models.user import User
from app.models.psychometric import PsychometricProfile, AnalysisStatus
from app.models.invitation import Invitation
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

        # Enforce invitation gate when gender is first set to "man"
        new_gender = attrs.get("gender")
        if new_gender == "man" and current_user.gender != "man":
            if not body.invitation_token:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Men must join with an invitation from a woman",
                )
            # Atomic UPDATE — prevents race conditions (TOCTOU).
            # Only succeeds if the token exists, is unused, and has not expired.
            now = datetime.now(timezone.utc)
            consumed = await db.execute(
                sql_update(Invitation)
                .where(
                    Invitation.token == body.invitation_token.upper(),
                    Invitation.used_by.is_(None),
                    Invitation.expires_at > now,
                )
                .values(used_by=current_user.id, used_at=now)
                .returning(Invitation.id)
            )
            if consumed.scalar_one_or_none() is None:
                raise HTTPException(
                    status_code=403,
                    detail="Invitation is invalid, expired, or already used",
                )

        for key, value in attrs.items():
            setattr(current_user, key, value)
        db.add(current_user)

    await db.commit()

    result = await db.execute(
        select(PsychometricProfile).where(
            PsychometricProfile.user_id == current_user.id
        )
    )
    profile = result.scalar_one_or_none()
    return _build_profile_response(current_user, profile)


@router.get("/analysis-status")
async def analysis_status(
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    # Only fetch the two columns we need — avoids loading 3×384-dim vectors
    row = (await db.execute(
        select(PsychometricProfile.analysis_status, PsychometricProfile.identity_vector)
        .where(PsychometricProfile.user_id == user_id)
    )).first()

    if not row:
        return {"analysis_status": "pending"}

    current_status, identity_vector = row

    if current_status == AnalysisStatus.failed and identity_vector is not None:
        await db.execute(
            sql_update(PsychometricProfile)
            .where(PsychometricProfile.user_id == user_id)
            .values(analysis_status=AnalysisStatus.complete)
        )
        await db.commit()
        return {"analysis_status": AnalysisStatus.complete}

    return {"analysis_status": current_status}
