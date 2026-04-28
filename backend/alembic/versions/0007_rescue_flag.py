"""add rescue flag columns to users

Revision ID: 0007
Revises: e1f2a3b4c5d6
Create Date: 2026-04-28 00:00:00.000000
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "0007"
down_revision: Union[str, Sequence[str], None] = "e1f2a3b4c5d6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "rescue_flagged",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )
    op.add_column(
        "users",
        sa.Column("rescue_flagged_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "rescue_flagged_at")
    op.drop_column("users", "rescue_flagged")
