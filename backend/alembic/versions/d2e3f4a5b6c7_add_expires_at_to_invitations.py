"""add expires_at to invitations

Revision ID: d2e3f4a5b6c7
Revises: c1a2b3d4e5f6
Create Date: 2026-04-25 12:00:00.000000

"""

from typing import Sequence, Union
from datetime import datetime, timezone, timedelta

from alembic import op
import sqlalchemy as sa


revision: str = "d2e3f4a5b6c7"
down_revision: Union[str, Sequence[str], None] = "c1a2b3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add expires_at — default existing rows to 7 days from now
    op.add_column(
        "invitations",
        sa.Column(
            "expires_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW() + INTERVAL '7 days'"),
        ),
    )


def downgrade() -> None:
    op.drop_column("invitations", "expires_at")
