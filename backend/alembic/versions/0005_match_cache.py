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
    op.create_table(
        "matches",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column(
            "user_id",
            sa.String(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "matched_user_id",
            sa.String(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("compatibility_score", sa.Float(), nullable=False),
        sa.Column("dimension_scores", sa.JSON(), nullable=False),
        sa.Column("computed_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_matches_user_id", "matches", ["user_id"])
    op.create_unique_constraint(
        "uq_matches_pair", "matches", ["user_id", "matched_user_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_matches_user_id", "matches")
    op.drop_table("matches")
    op.drop_column("users", "last_matched_at")
