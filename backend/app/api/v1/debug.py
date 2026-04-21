"""
Housekeeping / Debug APIs for testing matching logic.
Accessible via X-Admin-Token header.
"""

from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.config import settings
from app.models.user import User
from app.models.psychometric import PsychometricProfile
from app.models.match import Match
from app.schemas.matches import MatchDetail, MatchSummary, DimensionScore
from app.services.matching_service import get_match_detail as compute_match_detail

router = APIRouter(prefix="/debug", tags=["debug"])


def verify_admin_token(x_admin_token: Annotated[str | None, Header()] = None):
    if not settings.debug_api_token:
        raise HTTPException(status_code=501, detail="Debug APIs not enabled")
    if x_admin_token != settings.debug_api_token:
        raise HTTPException(status_code=403, detail="Invalid admin token")
    return True


@router.get("/user-by-email/{email}")
async def get_user_by_email(
    email: str,
    db: AsyncSession = Depends(get_db),
    _: bool = Depends(verify_admin_token),
):
    """Get user info by email."""
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "age": user.age,
        "gender": user.gender,
        "hard_filters": user.hard_filters,
    }


@router.get("/profile-by-email/{email}")
async def get_profile_by_email(
    email: str,
    db: AsyncSession = Depends(get_db),
    _: bool = Depends(verify_admin_token),
):
    """Get full psychometric profile by email."""
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    profile_result = await db.execute(
        select(PsychometricProfile).where(PsychometricProfile.user_id == user.id)
    )
    profile = profile_result.scalar_one_or_none()
    if not profile:
        return {"user": {"email": email, "name": user.name}, "profile": None}

    return {
        "user": {"email": user.email, "name": user.name, "age": user.age},
        "profile": {
            "ocean_scores": profile.ocean_scores,
            "attachment_style": profile.attachment_style,
            "values_profile": profile.values_profile,
            "effort_score": profile.effort_score,
            "smv_score": profile.smv_score,
            "analysis_status": profile.analysis_status.value
            if profile.analysis_status
            else None,
            "has_identity_vector": profile.identity_vector is not None,
            "has_aspiration_vector": profile.aspiration_vector is not None,
            "has_communication_vector": profile.communication_vector is not None,
        },
    }


@router.post("/simulate-match")
async def simulate_match(
    email_a: str,
    email_b: str,
    skip_algorithm: bool = False,
    db: AsyncSession = Depends(get_db),
    _: bool = Depends(verify_admin_token),
):
    """
    Simulate matching between two users by email.
    Returns compatibility details WITHOUT creating an actual match.

    - skip_algorithm: if True, returns 100% match without running algorithm
    """
    # Get user A
    result_a = await db.execute(select(User).where(User.email == email_a))
    user_a = result_a.scalar_one_or_none()
    if not user_a:
        raise HTTPException(status_code=404, detail=f"User {email_a} not found")

    # Get user B
    result_b = await db.execute(select(User).where(User.email == email_b))
    user_b = result_b.scalar_one_or_none()
    if not user_b:
        raise HTTPException(status_code=404, detail=f"User {email_b} not found")

    if skip_algorithm:
        return {
            "user_a": {"email": email_a, "name": user_a.name},
            "user_b": {"email": email_b, "name": user_b.name},
            "compatibility_score": 1.0,
            "simulated": True,
            "message": "Algorithm skipped - 100% match returned",
        }

    # Compute real match
    detail = await compute_match_detail(user_a, user_b.id, db)
    if not detail:
        raise HTTPException(
            status_code=400,
            detail="Cannot compute match - missing profiles or vectors",
        )

    return {
        "user_a": {"email": email_a, "name": user_a.name},
        "user_b": {"email": email_b, "name": user_b.name},
        "compatibility_score": detail.compatibility_score,
        "dimension_scores": detail.dimension_scores,
        "attachment_style": detail.attachment_style,
        "shared_values": detail.shared_values,
    }


@router.post("/force-match")
async def force_match(
    email_a: str,
    email_b: str,
    db: AsyncSession = Depends(get_db),
    _: bool = Depends(verify_admin_token),
):
    """
    Force create a match between two users by email.
    Computes real compatibility score then stores the match.
    """
    # Get user A
    result_a = await db.execute(select(User).where(User.email == email_a))
    user_a = result_a.scalar_one_or_none()
    if not user_a:
        raise HTTPException(status_code=404, detail=f"User {email_a} not found")

    # Get user B
    result_b = await db.execute(select(User).where(User.email == email_b))
    user_b = result_b.scalar_one_or_none()
    if not user_b:
        raise HTTPException(status_code=404, detail=f"User {email_b} not found")

    # Check if match already exists
    existing = await db.execute(
        select(Match).where(
            ((Match.user_a_id == user_a.id) & (Match.user_b_id == user_b.id))
            | ((Match.user_a_id == user_b.id) & (Match.user_b_id == user_a.id))
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Match already exists")

    # Compute real score
    detail = await compute_match_detail(user_a, user_b.id, db)
    score = detail.compatibility_score if detail else 0.0
    dim_scores = {d.label: d.score for d in detail.dimension_scores} if detail else {}

    # Create match
    match = Match(
        user_a_id=user_a.id,
        user_b_id=user_b.id,
        compatibility_score=score,
        dimension_scores=dim_scores,
    )
    db.add(match)
    await db.commit()

    return {
        "id": match.id,
        "user_a": {"email": email_a, "name": user_a.name},
        "user_b": {"email": email_b, "name": user_b.name},
        "compatibility_score": score,
        "message": "Match created successfully",
    }


@router.get("/list-users")
async def list_users(
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
    _: bool = Depends(verify_admin_token),
):
    """List users with their profile status."""
    result = await db.execute(
        select(User).order_by(User.created_at.desc()).limit(limit)
    )
    users = result.scalars().all()

    output = []
    for user in users:
        profile_result = await db.execute(
            select(PsychometricProfile).where(PsychometricProfile.user_id == user.id)
        )
        profile = profile_result.scalar_one_or_none()
        output.append(
            {
                "email": user.email,
                "name": user.name,
                "age": user.age,
                "has_profile": profile is not None,
                "analysis_status": profile.analysis_status.value if profile else None,
            }
        )
    return output
