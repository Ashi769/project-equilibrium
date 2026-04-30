"""add no-show tracking columns

Revision ID: 0010
Revises: 0009
Create Date: 2026-04-30 00:00:00.000000
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "0010"
down_revision: Union[str, Sequence[str], None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("no_show_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "meetings",
        sa.Column("proposer_joined_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "meetings",
        sa.Column("match_joined_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "meetings",
        sa.Column(
            "no_show_checked",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )


def downgrade() -> None:
    op.drop_column("meetings", "no_show_checked")
    op.drop_column("meetings", "match_joined_at")
    op.drop_column("meetings", "proposer_joined_at")
    op.drop_column("users", "no_show_count")
