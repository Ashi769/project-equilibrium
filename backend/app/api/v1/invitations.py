from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.config import settings
from app.models.user import User
from app.models.invitation import Invitation, InvitationStatus
from app.schemas.invitation import InvitationOut, InvitationJoinInfo, InvitationListResponse

router = APIRouter(prefix="/invitations", tags=["invitations"])


def _consumed_count_query(user_id: str):
    """Count invitations that consume a slot: used ones (permanent) + active-and-unexpired ones.
    Revoked and expired-unused invitations free their slot back."""
    now = datetime.now(timezone.utc)
    return (
        select(func.count())
        .where(
            Invitation.created_by == user_id,
            (Invitation.status == InvitationStatus.used)
            | (
                (Invitation.status == InvitationStatus.active)
                & (Invitation.expires_at > now)
            ),
        )
    )


@router.get("/join/{code}", response_model=InvitationJoinInfo)
async def join_info(code: str, db: AsyncSession = Depends(get_db)):
    """Public endpoint — returns invite context so the landing page can show inviter name."""
    result = await db.execute(
        select(Invitation).where(Invitation.token == code.upper())
    )
    invitation = result.scalar_one_or_none()

    if not invitation:
        raise HTTPException(status_code=404, detail="Invitation not found")
    if invitation.status == InvitationStatus.used:
        raise HTTPException(status_code=410, detail="This invitation has already been used")
    if invitation.status == InvitationStatus.revoked:
        raise HTTPException(status_code=410, detail="This invitation has been revoked")
    if datetime.now(timezone.utc) > invitation.expires_at:
        raise HTTPException(status_code=410, detail="This invitation has expired")

    # Load creator name
    creator_result = await db.execute(select(User).where(User.id == invitation.created_by))
    creator = creator_result.scalar_one()

    return InvitationJoinInfo(
        token=invitation.token,
        inviter_name=creator.name,
        expires_at=invitation.expires_at,
    )


@router.post("", response_model=InvitationOut, status_code=status.HTTP_201_CREATED)
async def create_invitation(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.gender != "woman":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only women can create invitations",
        )

    count_result = await db.execute(_consumed_count_query(current_user.id))
    consumed = count_result.scalar_one()
    if consumed >= settings.max_invitations_per_woman:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"You have reached the maximum of {settings.max_invitations_per_woman} invitations.",
        )

    invitation = Invitation(created_by=current_user.id)
    db.add(invitation)
    await db.flush()
    return InvitationOut.model_validate(invitation)


@router.delete("/{invitation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_invitation(
    invitation_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Invitation).where(
            Invitation.id == invitation_id,
            Invitation.created_by == current_user.id,
        )
    )
    invitation = result.scalar_one_or_none()
    if not invitation:
        raise HTTPException(status_code=404, detail="Invitation not found")
    if invitation.status == InvitationStatus.revoked:
        raise HTTPException(status_code=400, detail="Invitation is already revoked")
    if invitation.status == InvitationStatus.used:
        raise HTTPException(status_code=400, detail="Cannot revoke a used invitation")

    invitation.status = InvitationStatus.revoked
    invitation.revoked_at = datetime.now(timezone.utc)
    await db.commit()


@router.get("", response_model=InvitationListResponse)
async def list_invitations(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.gender != "woman":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only women can view invitations",
        )

    result = await db.execute(
        select(Invitation)
        .where(Invitation.created_by == current_user.id)
        .order_by(Invitation.created_at.asc())
    )
    invitations = result.scalars().all()

    consumed_result = await db.execute(_consumed_count_query(current_user.id))
    consumed = consumed_result.scalar_one()
    max_allowed = settings.max_invitations_per_woman
    used_count = sum(1 for inv in invitations if inv.status == InvitationStatus.used)

    return InvitationListResponse(
        invitations=[InvitationOut.model_validate(inv) for inv in invitations],
        used_count=used_count,
        remaining=max(0, max_allowed - consumed),
        max_allowed=max_allowed,
    )
