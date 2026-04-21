"""add verdict notification tracking

Revision ID: 8555f79346c0
Revises: 0004
Create Date: 2026-04-21 18:24:20.888673

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "8555f79346c0"
down_revision: Union[str, Sequence[str], None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "meetings",
        sa.Column(
            "proposer_notified_commit",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )
    op.add_column(
        "meetings",
        sa.Column(
            "match_notified_commit",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("meetings", "match_notified_commit")
    op.drop_column("meetings", "proposer_notified_commit")
