"""add lifestyle fields to users

Revision ID: bb3d5a63294f
Revises: 8555f79346c0
Create Date: 2026-04-21 19:30:59.616730

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "bb3d5a63294f"
down_revision: Union[str, Sequence[str], None] = "8555f79346c0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("height", sa.Integer(), nullable=True))
    op.add_column("users", sa.Column("drinking", sa.String(length=20), nullable=True))
    op.add_column("users", sa.Column("smoking", sa.String(length=20), nullable=True))
    op.add_column("users", sa.Column("religion", sa.String(length=50), nullable=True))
    op.add_column("users", sa.Column("language", sa.String(length=50), nullable=True))
    op.add_column(
        "users", sa.Column("food_preference", sa.String(length=20), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("users", "food_preference")
    op.drop_column("users", "language")
    op.drop_column("users", "religion")
    op.drop_column("users", "smoking")
    op.drop_column("users", "drinking")
    op.drop_column("users", "height")
