import uuid
from datetime import datetime, timezone
from enum import Enum
from sqlalchemy import (
    String,
    Float,
    JSON,
    DateTime,
    ForeignKey,
    UniqueConstraint,
    Index,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class MatchStatus(str, Enum):
    active = "active"
    consumed = "consumed"   # match proposed a meeting
    evicted = "evicted"     # bumped from cache by higher-scoring match
    expired = "expired"     # outside cooldown window, not in current top-N


class Match(Base):
    __tablename__ = "matches"
    __table_args__ = (
        UniqueConstraint("user_id", "matched_user_id", name="uq_match_pair"),
    )

    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: str(uuid.uuid4())
    )
    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    matched_user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    compatibility_score: Mapped[float] = mapped_column(Float, nullable=False)
    dimension_scores: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    computed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    first_matched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    status: Mapped[MatchStatus] = mapped_column(
        String(16), nullable=False, default=MatchStatus.active
    )
    status_changed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    user: Mapped["User"] = relationship(
        "User", back_populates="cached_matches", foreign_keys=[user_id]
    )
