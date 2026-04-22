import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Integer, JSON, DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: str(uuid.uuid4())
    )
    email: Mapped[str] = mapped_column(
        String(255), unique=True, nullable=False, index=True
    )
    password_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    google_id: Mapped[str | None] = mapped_column(
        String(255), unique=True, nullable=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    age: Mapped[int | None] = mapped_column(Integer, nullable=True)
    gender: Mapped[str | None] = mapped_column(String(50), nullable=True)
    location: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Lifestyle attributes
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    drinking: Mapped[str | None] = mapped_column(String(20), nullable=True)
    smoking: Mapped[str | None] = mapped_column(String(20), nullable=True)
    religion: Mapped[str | None] = mapped_column(String(50), nullable=True)
    food_preference: Mapped[str | None] = mapped_column(String(20), nullable=True)

    hard_filters: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    last_matched_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    psychometric_profile: Mapped["PsychometricProfile"] = relationship(
        "PsychometricProfile", back_populates="user", uselist=False, lazy="select"
    )
    interview_sessions: Mapped[list["InterviewSession"]] = relationship(
        "InterviewSession", back_populates="user", lazy="select"
    )
    photos: Mapped[list["UserPhoto"]] = relationship(
        "UserPhoto", back_populates="user", lazy="select"
    )
    cached_matches: Mapped[list["Match"]] = relationship(
        "Match",
        back_populates="user",
        foreign_keys="Match.user_id",
        lazy="select",
    )
