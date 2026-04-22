"""fix users primary key

Revision ID: FIXPK
Revises: RENAMECOLS
Create Date: 2026-04-22 19:35:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "FIXPK"
down_revision: Union[str, Sequence[str], None] = "RENAMECOLS"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD PRIMARY KEY (id)")


def downgrade() -> None:
    pass
