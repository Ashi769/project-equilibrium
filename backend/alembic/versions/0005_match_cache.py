"""add matches and last_matched_at

Revision ID: 0005
Revises: 0004
Create Date: 2026-04-22
"""

from alembic import op
import sqlalchemy as sa

revision = "0005"
down_revision = "bb3d5a63294f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("last_matched_at", sa.DateTime(timezone=True), nullable=True),
    )
    # matches table already exists from 0001_initial_schema; just add the missing index
    op.create_index("ix_matches_user_id", "matches", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_matches_user_id", "matches")
    op.drop_column("users", "last_matched_at")
