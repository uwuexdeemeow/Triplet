"""add rate limits and lowercase emails

Revision ID: b5e2d8f41c07
Revises: a7c3e91f2d10
Create Date: 2026-09-27 21:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b5e2d8f41c07'
down_revision: Union[str, Sequence[str], None] = 'a7c3e91f2d10'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Recent attempts per key, to slow down password guessing and other abuse
    op.create_table(
        'rate_limits',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('key', sa.String(length=255), nullable=False),
        sa.Column('window_start', sa.DateTime(timezone=True), nullable=False),
        sa.Column('count', sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('key'),
    )
    # Emails are now compared lowercased; store them that way too. Fails loudly if two accounts
    # differ only by case, which needs a person to decide which one to keep.
    op.execute("UPDATE users SET email = LOWER(email) WHERE email <> LOWER(email)")


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('rate_limits')
