"""add first_matched_at to matches

Revision ID: 0006_match_first_matched_at
Revises: e1f2a3b4c5d6
Create Date: 2026-04-27
"""

from alembic import op
import sqlalchemy as sa

revision = "0006_match_first_matched_at"
down_revision = "e1f2a3b4c5d6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "matches",
        sa.Column(
            "first_matched_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    # Backfill existing rows — treat computed_at as the first time they were shown
    op.execute("UPDATE matches SET first_matched_at = computed_at WHERE first_matched_at IS NULL")
    op.alter_column("matches", "first_matched_at", nullable=False)


def downgrade() -> None:
    op.drop_column("matches", "first_matched_at")
