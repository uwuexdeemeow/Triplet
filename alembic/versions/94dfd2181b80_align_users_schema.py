"""align users schema

Revision ID: 94dfd2181b80
Revises: c93560ccb345
Create Date: 2026-08-15 19:36:04.333685

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '94dfd2181b80'
down_revision: Union[str, Sequence[str], None] = 'c93560ccb345'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.alter_column(
        "users",
        "name",
        existing_type=sa.Text(),
        type_=sa.String(length=255),
        existing_nullable=False,
    )

    op.alter_column(
        "users",
        "email",
        existing_type=sa.Text(),
        type_=sa.String(length=255),
        existing_nullable=False,
    )

    op.alter_column(
        "users",
        "password",
        existing_type=sa.Text(),
        type_=sa.String(length=255),
        existing_nullable=False,
    )

    op.alter_column(
        "users",
        "avatar_url",
        existing_type=sa.Text(),
        type_=sa.String(length=500),
        existing_nullable=True,
    )



def downgrade() -> None:
    """Downgrade schema."""
    op.alter_column(
        "users",
        "name",
        existing_type=sa.String(length=255),
        type_=sa.Text(),
        existing_nullable=False,
    )

    op.alter_column(
        "users",
        "email",
        existing_type=sa.String(length=255),
        type_=sa.Text(),
        existing_nullable=False,
    )

    op.alter_column(
        "users",
        "password",
        existing_type=sa.String(length=255),
        type_=sa.Text(),
        existing_nullable=False,
    )

    op.alter_column(
        "users",
        "avatar_url",
        existing_type=sa.String(length=500),
        type_=sa.Text(),
        existing_nullable=True,
    )
