"""rename matches columns user_a_id to user_id

Revision ID: RENAMECOLS
Revises: ADDINDEXES
Create Date: 2026-04-22 19:30:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "RENAMECOLS"
down_revision: Union[str, Sequence[str], None] = "ADDINDEXES"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    if op.get_context().dialect.name == "postgresql":
        op.execute("ALTER TABLE matches RENAME COLUMN user_a_id TO user_id")
        op.execute("ALTER TABLE matches RENAME COLUMN user_b_id TO matched_user_id")


def downgrade() -> None:
    if op.get_context().dialect.name == "postgresql":
        op.execute("ALTER TABLE matches RENAME COLUMN user_id TO user_a_id")
        op.execute("ALTER TABLE matches RENAME COLUMN matched_user_id TO user_b_id")
