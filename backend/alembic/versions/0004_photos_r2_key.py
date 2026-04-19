"""add r2_key to user_photos

Revision ID: 0004
Revises: 0003
Create Date: 2026-04-19
"""

from alembic import op
import sqlalchemy as sa

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "user_photos",
        sa.Column("r2_key", sa.String(512), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_column("user_photos", "r2_key")
