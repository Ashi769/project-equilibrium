"""add user_photos table and smv_score column

Revision ID: 0002
Revises: 0001
Create Date: 2026-04-17
"""

from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_photos",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("is_selfie", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_user_photos_user_id", "user_photos", ["user_id"])

    op.add_column(
        "psychometric_profiles",
        sa.Column("smv_score", sa.Float(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("psychometric_profiles", "smv_score")
    op.drop_index("ix_user_photos_user_id", table_name="user_photos")
    op.drop_table("user_photos")
