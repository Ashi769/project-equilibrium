import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Float, JSON, Boolean, DateTime, ForeignKey, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from pgvector.sqlalchemy import Vector
from app.core.database import Base
import enum


class AnalysisStatus(str, enum.Enum):
    pending = "pending"
    processing = "processing"
    complete = "complete"
    failed = "failed"


class PsychometricProfile(Base):
    __tablename__ = "psychometric_profiles"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)

    # OCEAN scores (0.0 - 1.0 each)
    ocean_scores: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    attachment_style: Mapped[str | None] = mapped_column(String(50), nullable=True)
    values_profile: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    effort_score: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Hidden SMV score from visual audit (0.0 - 10.0, never exposed to users)
    smv_score: Mapped[float | None] = mapped_column(Float, nullable=True)

    # pgvector columns — 384 dims (all-MiniLM-L6-v2)
    identity_vector: Mapped[list[float] | None] = mapped_column(Vector(384), nullable=True)
    aspiration_vector: Mapped[list[float] | None] = mapped_column(Vector(384), nullable=True)
    communication_vector: Mapped[list[float] | None] = mapped_column(Vector(384), nullable=True)

    # Data decay: flag profiles for re-interview after 6-12 months
    last_interview_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reinterview_due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reinterview_nudged: Mapped[bool] = mapped_column(default=False, nullable=False)

    analysis_status: Mapped[AnalysisStatus] = mapped_column(
        SAEnum(AnalysisStatus, name="analysis_status_enum"),
        default=AnalysisStatus.pending,
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )

    user: Mapped["User"] = relationship("User", back_populates="psychometric_profile")
