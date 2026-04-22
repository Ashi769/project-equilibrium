from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from app.core.database import get_db
from app.core.security import decode_token
from app.models.user import User
from app.models.psychometric import PsychometricProfile

bearer = HTTPBearer()

_user_cache: dict[str, tuple[User, PsychometricProfile | None]] = {}
_cache_ttl = 30


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    try:
        payload = decode_token(credentials.credentials)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
        )

    if payload.get("type") != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not an access token"
        )

    user_id = payload.get("sub")

    if user_id in _user_cache:
        cached_user, cached_profile = _user_cache[user_id]
        import time

        if time.time() - cached_user._cached_at < _cache_ttl:
            return cached_user

    result = await db.execute(
        select(User)
        .options(selectinload(User.psychometric_profile))
        .where(User.id == user_id)
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found"
        )

    import time

    user._cached_at = time.time()
    _user_cache[user_id] = (user, user.psychometric_profile)

    return user
