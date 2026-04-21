import logging
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from google.oauth2 import id_token as google_id_token
from google.auth.transport import requests as google_requests

from app.core.database import get_db
from app.core.security import (
    hash_password,
    verify_password,
    create_access_token,
    create_refresh_token,
    decode_token,
)
from app.core.config import settings
from app.models.user import User
from app.models.psychometric import PsychometricProfile
from app.schemas.auth import (
    RegisterRequest,
    LoginRequest,
    GoogleAuthRequest,
    TokenResponse,
    UserOut,
    RefreshRequest,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])


def _token_response(user: User) -> TokenResponse:
    return TokenResponse(
        access_token=create_access_token(user.id),
        refresh_token=create_refresh_token(user.id),
        user=UserOut.model_validate(user),
    )


@router.post(
    "/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED
)
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    logger.info(f"[DEBUG] Register called for email: {body.email}")
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        logger.warning(f"[DEBUG] Register failed - email already exists: {body.email}")
        raise HTTPException(status_code=409, detail="Email already registered")

    if len(body.password) < 8:
        logger.warning(
            f"[DEBUG] Register failed - password too short for email: {body.email}"
        )
        raise HTTPException(
            status_code=422, detail="Password must be at least 8 characters"
        )

    user = User(
        email=body.email,
        password_hash=hash_password(body.password),
        name=body.name,
        age=body.age,
        gender=body.gender,
    )
    db.add(user)
    await db.flush()

    profile = PsychometricProfile(user_id=user.id)
    logger.info(f"[DEBUG] Register successful for user: {user.id}, email: {user.email}")
    db.add(profile)

    return _token_response(user)


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    logger.info(f"[DEBUG] Login called for email: {body.email}")
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if (
        not user
        or not user.password_hash
        or not verify_password(body.password, user.password_hash)
    ):
        logger.warning(f"[DEBUG] Login failed for email: {body.email}")
        raise HTTPException(status_code=401, detail="Invalid email or password")

    logger.info(f"[DEBUG] Login successful for user: {user.id}")
    return _token_response(user)


@router.post("/google", response_model=TokenResponse)
async def google_auth(body: GoogleAuthRequest, db: AsyncSession = Depends(get_db)):
    # If google_id provided directly (not via id_token verification)
    if body.google_id and body.email:
        google_id = body.google_id
        email = body.email
        name = body.name or email.split("@")[0]
        logger.info(
            f"[DEBUG] Google auth via sync: google_id: {google_id}, email: {email}"
        )
    else:
        # Original flow with id_token verification
        logger.info(
            f"[DEBUG] Google auth called, id_token present: {bool(body.id_token)}"
        )
        try:
            idinfo = google_id_token.verify_oauth2_token(
                body.id_token,
                google_requests.Request(),
                settings.google_client_id,
            )
            logger.info(
                f"[DEBUG] Google token verified, sub: {idinfo.get('sub')}, email: {idinfo.get('email')}"
            )
        except Exception as e:
            logger.error(f"[DEBUG] Google token verification failed: {e}")
            raise HTTPException(status_code=401, detail="Invalid Google token")

        google_id = idinfo["sub"]
        email = idinfo["email"]
        name = idinfo.get("name", email.split("@")[0])
        logger.info(
            f"[DEBUG] Google auth - google_id: {google_id}, email: {email}, name: {name}"
        )

    # Find by google_id or email
    result = await db.execute(
        select(User).where((User.google_id == google_id) | (User.email == email))
    )
    user = result.scalar_one_or_none()

    logger.info(f"[DEBUG] Google auth - existing user found: {user is not None}")
    if user:
        if not user.google_id:
            user.google_id = google_id
            logger.info(
                f"[DEBUG] Google auth - linked google_id to existing user: {user.id}"
            )
    else:
        user = User(email=email, google_id=google_id, name=name)
        db.add(user)
        await db.flush()
        db.add(PsychometricProfile(user_id=user.id))
        logger.info(f"[DEBUG] Google auth - created new user: {user.id}")

    logger.info(
        f"[DEBUG] Google auth - returning token for user: {user.id}, email: {user.email}"
    )
    return _token_response(user)


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(body: RefreshRequest, db: AsyncSession = Depends(get_db)):
    logger.info("[DEBUG] Refresh token called")
    try:
        payload = decode_token(body.refresh_token)
    except ValueError as e:
        logger.error(f"[DEBUG] Refresh token decode failed: {e}")
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    if payload.get("type") != "refresh":
        logger.error(f"[DEBUG] Refresh token invalid type: {payload.get('type')}")
        raise HTTPException(status_code=401, detail="Not a refresh token")

    result = await db.execute(select(User).where(User.id == payload["sub"]))
    user = result.scalar_one_or_none()
    if not user:
        logger.error(f"[DEBUG] Refresh token user not found: {payload.get('sub')}")
        raise HTTPException(status_code=401, detail="User not found")

    logger.info(f"[DEBUG] Refresh successful for user: {user.id}")
    return _token_response(user)


@router.post("/sync", response_model=TokenResponse)
async def sync_google_user(body: GoogleSyncRequest, db: AsyncSession = Depends(get_db)):
    logger.info(
        f"[DEBUG] Sync called for google_id: {body.google_id}, email: {body.email}"
    )

    result = await db.execute(
        select(User).where(
            (User.google_id == body.google_id) | (User.email == body.email)
        )
    )
    user = result.scalar_one_or_none()

    if user:
        if not user.google_id:
            user.google_id = body.google_id
            logger.info(f"[DEBUG] Synced google_id to existing user: {user.id}")
    else:
        user = User(
            email=body.email,
            google_id=body.google_id,
            name=body.name or body.email.split("@")[0],
        )
        db.add(user)
        await db.flush()
        db.add(PsychometricProfile(user_id=user.id))
        logger.info(f"[DEBUG] Created new user via sync: {user.id}")

    return _token_response(user)
