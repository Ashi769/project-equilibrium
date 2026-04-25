"""merge heads: ADDINDEXES + invitation migrations

Revision ID: e1f2a3b4c5d6
Revises: ADDINDEXES, d2e3f4a5b6c7
Create Date: 2026-04-26 00:00:00.000000

"""

from typing import Sequence, Union

revision: str = "e1f2a3b4c5d6"
down_revision: Union[str, Sequence[str], None] = ("ADDINDEXES", "d2e3f4a5b6c7")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
