"""add match_candidates table for 2-pass mutual matching

Revision ID: 0011
Revises: 0010
Create Date: 2026-05-08 00:00:00.000000
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "0011"
down_revision: Union[str, Sequence[str], None] = "0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "match_candidates",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("candidate_id", sa.String(), nullable=False),
        sa.Column("score", sa.Float(), nullable=False),
        sa.Column("is_rescue", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column(
            "computed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(["candidate_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "candidate_id"),
    )
    op.create_index(
        "ix_match_candidates_candidate_id", "match_candidates", ["candidate_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_match_candidates_candidate_id", table_name="match_candidates")
    op.drop_table("match_candidates")
