"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-04-16
"""

from alembic import op
import sqlalchemy as sa
from pgvector.sqlalchemy import Vector

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Enable pgvector extension
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    op.create_table(
        "users",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=True),
        sa.Column("google_id", sa.String(255), nullable=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("age", sa.Integer(), nullable=True),
        sa.Column("gender", sa.String(50), nullable=True),
        sa.Column("location", sa.String(255), nullable=True),
        sa.Column("hard_filters", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
        sa.UniqueConstraint("google_id"),
    )
    op.create_index("ix_users_email", "users", ["email"])

    op.create_table(
        "psychometric_profiles",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("ocean_scores", sa.JSON(), nullable=True),
        sa.Column("attachment_style", sa.String(50), nullable=True),
        sa.Column("values_profile", sa.JSON(), nullable=True),
        sa.Column("effort_score", sa.Float(), nullable=True),
        sa.Column("identity_vector", Vector(384), nullable=True),
        sa.Column("aspiration_vector", Vector(384), nullable=True),
        sa.Column(
            "analysis_status",
            sa.Enum("pending", "processing", "complete", "failed", name="analysis_status_enum"),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id"),
    )
    # HNSW index for fast approximate nearest-neighbor search
    op.execute(
        "CREATE INDEX psychometric_identity_vector_idx ON psychometric_profiles "
        "USING hnsw (identity_vector vector_cosine_ops)"
    )

    op.create_table(
        "interview_sessions",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("transcript_encrypted", sa.LargeBinary(), nullable=True),
        sa.Column(
            "processing_status",
            sa.Enum("pending", "processing", "complete", "failed", name="processing_status_enum"),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_interview_sessions_user_id", "interview_sessions", ["user_id"])

    op.create_table(
        "matches",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_a_id", sa.String(), nullable=False),
        sa.Column("user_b_id", sa.String(), nullable=False),
        sa.Column("compatibility_score", sa.Float(), nullable=False),
        sa.Column("dimension_scores", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("computed_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_a_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_b_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_a_id", "user_b_id", name="uq_match_pair"),
    )


def downgrade() -> None:
    op.drop_table("matches")
    op.drop_table("interview_sessions")
    op.drop_table("psychometric_profiles")
    op.drop_table("users")
    op.execute("DROP TYPE IF EXISTS analysis_status_enum")
    op.execute("DROP TYPE IF EXISTS processing_status_enum")
    op.execute("DROP EXTENSION IF EXISTS vector")
