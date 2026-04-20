"""add communication_vector, data decay fields, and meetings table

Revision ID: 0003
Revises: 0002
Create Date: 2026-04-17
"""

from alembic import op
import sqlalchemy as sa
from pgvector.sqlalchemy import Vector

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Communication style vector on psychometric_profiles
    op.add_column(
        "psychometric_profiles",
        sa.Column("communication_vector", Vector(384), nullable=True),
    )

    # Data decay columns
    op.add_column(
        "psychometric_profiles",
        sa.Column("last_interview_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "psychometric_profiles",
        sa.Column("reinterview_due_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "psychometric_profiles",
        sa.Column(
            "reinterview_nudged", sa.Boolean(), nullable=False, server_default="false"
        ),
    )

    # Meetings table for scheduling and verdict tracking
    meeting_status = sa.Enum(
        "proposed",
        "confirmed",
        "completed",
        "cancelled",
        name="meeting_status_enum",
        create_constraint=True,
    )
    verdict_choice = sa.Enum(
        "commit", "pool", name="verdict_choice_enum", create_constraint=True
    )

    op.create_table(
        "meetings",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("proposer_id", sa.String(), nullable=False),
        sa.Column("match_id", sa.String(), nullable=False),
        sa.Column("slot_1", sa.DateTime(timezone=True), nullable=False),
        sa.Column("slot_2", sa.DateTime(timezone=True), nullable=False),
        sa.Column("slot_3", sa.DateTime(timezone=True), nullable=False),
        sa.Column("locked_slot", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", meeting_status, nullable=False, server_default="proposed"),
        sa.Column("proposer_verdict", verdict_choice, nullable=True),
        sa.Column("match_verdict", verdict_choice, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["proposer_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["match_id"], ["matches.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("proposer_id", "match_id", name="uq_meeting_pair"),
    )


def downgrade() -> None:
    op.drop_table("meetings")
    op.execute("DROP TYPE IF EXISTS meeting_status_enum")
    op.execute("DROP TYPE IF EXISTS verdict_choice_enum")
    op.drop_column("psychometric_profiles", "reinterview_nudged")
    op.drop_column("psychometric_profiles", "reinterview_due_at")
    op.drop_column("psychometric_profiles", "last_interview_at")
    op.drop_column("psychometric_profiles", "communication_vector")
