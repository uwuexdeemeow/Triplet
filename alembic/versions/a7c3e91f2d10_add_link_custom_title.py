"""add link custom title

Revision ID: a7c3e91f2d10
Revises: 78b1fed476be
Create Date: 2026-09-27 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a7c3e91f2d10'
down_revision: Union[str, Sequence[str], None] = '78b1fed476be'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # A name the user gives a saved post, kept when the post is looked up again
    op.add_column('saved_links', sa.Column('custom_title', sa.String(length=255), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('saved_links', 'custom_title')
