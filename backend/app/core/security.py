import logging
from datetime import datetime, timedelta, timezone
from typing import Any
import bcrypt
from jose import jwt, JWTError
from app.core.config import settings

logger = logging.getLogger(__name__)

ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_token(
    subject: str, expire_delta: timedelta, extra: dict[str, Any] | None = None
) -> str:
    payload = {
        "sub": subject,
        "exp": datetime.now(timezone.utc) + expire_delta,
        "iat": datetime.now(timezone.utc),
        **(extra or {}),
    }
    logger.info(
        f"[DEBUG] Creating token for subject: {subject}, type: {extra.get('type', 'unknown') if extra else 'none'}"
    )
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)


def create_access_token(user_id: str) -> str:
    return create_token(
        user_id,
        timedelta(minutes=settings.access_token_expire_minutes),
        {"type": "access"},
    )


def create_refresh_token(user_id: str) -> str:
    return create_token(
        user_id,
        timedelta(days=settings.refresh_token_expire_days),
        {"type": "refresh"},
    )


def decode_token(token: str) -> dict[str, Any]:
    logger.info("[DEBUG] Decoding token")
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
        logger.info(
            f"[DEBUG] Token decoded successfully, sub: {payload.get('sub')}, type: {payload.get('type')}"
        )
        return payload
    except JWTError as e:
        logger.error(f"[DEBUG] Token decode failed: {e}")
        raise ValueError(f"Invalid token: {e}") from e
