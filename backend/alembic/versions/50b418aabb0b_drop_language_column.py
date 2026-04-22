"""drop language column

Revision ID: 50b418aabb0b
Revises: bb3d5a63294f
Create Date: 2026-04-21 20:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "50b418aabb0b"
down_revision: Union[str, Sequence[str], None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column("users", "language")


def downgrade() -> None:
    op.add_column("users", sa.Column("language", sa.String(length=50), nullable=True))
