"""introduce status state management — no hard deletes

Revision ID: 0008
Revises: 0007
Create Date: 2026-04-28 00:00:00.000000
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "0008"
down_revision: Union[str, Sequence[str], None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # user_photos: track soft-delete state
    op.add_column(
        "user_photos",
        sa.Column("status", sa.String(16), nullable=False, server_default="active"),
    )
    op.add_column(
        "user_photos",
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )

    # invitations: explicit lifecycle state (active / used / revoked)
    op.add_column(
        "invitations",
        sa.Column("status", sa.String(16), nullable=False, server_default="active"),
    )
    op.add_column(
        "invitations",
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )
    # Backfill used invitations so the status column is consistent with existing data
    op.execute(
        "UPDATE invitations SET status = 'used' WHERE used_by IS NOT NULL"
    )


def downgrade() -> None:
    op.drop_column("invitations", "revoked_at")
    op.drop_column("invitations", "status")
    op.drop_column("user_photos", "deleted_at")
    op.drop_column("user_photos", "status")
