"""add last_matched_at to users

Revision ID: LASTMATCHED
Revises: bb3d5a63294f
Create Date: 2026-04-22 18:40:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "LASTMATCHED"
down_revision: Union[str, Sequence[str], None] = "50b418aabb0b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users", sa.Column("last_matched_at", sa.DateTime(timezone=True), nullable=True
    )


def downgrade() -> None:
    op.drop_column("users", "last_matched_at")