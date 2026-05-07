from datetime import datetime, timezone
from sqlalchemy import String, Float, Boolean, DateTime, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class MatchCandidate(Base):
    """
    Pass 1 scoring cache — rebuilt every batch cycle.

    Stores the top-K raw candidates per user before mutual filtering.
    The candidate_id index enables Group 2 lookups in Pass 2:
      "who has user X as a candidate?"
    Rescue-injected rows (is_rescue=True) survive truncation so they can be
    evaluated in Pass 1 alongside normally-scored candidates.
    """

    __tablename__ = "match_candidates"
    __table_args__ = (
        Index("ix_match_candidates_candidate_id", "candidate_id"),
    )

    user_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        primary_key=True,
    )
    candidate_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        primary_key=True,
    )
    score: Mapped[float] = mapped_column(Float, nullable=False)
    is_rescue: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    computed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
