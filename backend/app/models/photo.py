import uuid
from datetime import datetime, timezone
from enum import Enum
from sqlalchemy import String, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class PhotoStatus(str, Enum):
    active = "active"
    deleted = "deleted"


class UserPhoto(Base):
    __tablename__ = "user_photos"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    r2_key: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    is_selfie: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    status: Mapped[PhotoStatus] = mapped_column(String(16), nullable=False, default=PhotoStatus.active)
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped["User"] = relationship("User", back_populates="photos")
