"""add performance indexes

Revision ID: ADDINDEXES
Revises: 50b418aabb0b
Create Date: 2026-04-22 19:25:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "ADDINDEXES"
down_revision: Union[str, Sequence[str], None] = "50b418aabb0b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index("ix_meetings_proposer_id", "meetings", ["proposer_id"])
    op.create_index("ix_meetings_match_id", "meetings", ["match_id"])
    op.create_index("ix_meetings_created_at", "meetings", ["created_at"])
    op.create_index("ix_matches_matched_user_id", "matches", ["matched_user_id"])
    op.create_index("ix_matches_computed_at", "matches", ["computed_at"])
    op.create_index("ix_users_gender_age", "users", ["gender", "age"])


def downgrade() -> None:
    op.drop_index("ix_users_gender_age", "users")
    op.drop_index("ix_matches_computed_at", "matches")
    op.drop_index("ix_matches_matched_user_id", "matches")
    op.drop_index("ix_meetings_created_at", "meetings")
    op.drop_index("ix_meetings_match_id", "meetings")
    op.drop_index("ix_meetings_proposer_id", "meetings")
