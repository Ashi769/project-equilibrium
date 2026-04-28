import secrets
import string
import uuid
from datetime import datetime, timezone, timedelta
from enum import Enum
from sqlalchemy import String, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class InvitationStatus(str, Enum):
    active = "active"
    used = "used"
    revoked = "revoked"

# Unambiguous uppercase alphanumeric — no O/0/I/1 confusion
_ALPHABET = "".join(c for c in (string.ascii_uppercase + string.digits) if c not in "O0I1")


def _generate_code() -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(8))


def _default_expires() -> datetime:
    return datetime.now(timezone.utc) + timedelta(days=7)


class Invitation(Base):
    __tablename__ = "invitations"

    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: str(uuid.uuid4())
    )
    # Human-readable 8-char code — what gets shared (e.g. "K7X2MQ4N")
    token: Mapped[str] = mapped_column(
        String(16), unique=True, nullable=False, index=True, default=_generate_code
    )
    created_by: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    used_by: Mapped[str | None] = mapped_column(
        String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_default_expires
    )
    status: Mapped[InvitationStatus] = mapped_column(
        String(16), nullable=False, default=InvitationStatus.active
    )
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    creator: Mapped["User"] = relationship("User", foreign_keys=[created_by])
    invitee: Mapped["User"] = relationship("User", foreign_keys=[used_by])
