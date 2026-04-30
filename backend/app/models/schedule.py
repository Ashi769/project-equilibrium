import uuid
from datetime import datetime, timezone
from sqlalchemy import String, DateTime, ForeignKey, Enum as SAEnum, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base
import enum


class MeetingStatus(str, enum.Enum):
    proposed = "proposed"
    confirmed = "confirmed"
    completed = "completed"
    cancelled = "cancelled"


class VerdictChoice(str, enum.Enum):
    commit = "commit"
    pool = "pool"


class Meeting(Base):
    __tablename__ = "meetings"
    __table_args__ = (
        UniqueConstraint("proposer_id", "match_id", name="uq_meeting_pair"),
    )

    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: str(uuid.uuid4())
    )
    proposer_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    match_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )

    slot_1: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    slot_2: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    slot_3: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    locked_slot: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    status: Mapped[MeetingStatus] = mapped_column(
        SAEnum(MeetingStatus, name="meeting_status_enum"),
        default=MeetingStatus.proposed,
        nullable=False,
    )

    proposer_verdict: Mapped[VerdictChoice | None] = mapped_column(
        SAEnum(VerdictChoice, name="verdict_choice_enum"), nullable=True
    )
    match_verdict: Mapped[VerdictChoice | None] = mapped_column(
        SAEnum(VerdictChoice, name="verdict_choice_enum", create_constraint=False),
        nullable=True,
    )

    proposer_notified_commit: Mapped[bool] = mapped_column(
        default=False, nullable=False
    )
    match_notified_commit: Mapped[bool] = mapped_column(default=False, nullable=False)

    proposer_joined_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    match_joined_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    no_show_checked: Mapped[bool] = mapped_column(default=False, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
