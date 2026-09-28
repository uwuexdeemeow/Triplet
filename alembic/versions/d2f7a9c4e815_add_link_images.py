"""add link images

Revision ID: d2f7a9c4e815
Revises: c5d8e2f1a934
Create Date: 2026-09-28 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd2f7a9c4e815'
down_revision: Union[str, Sequence[str], None] = 'c5d8e2f1a934'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Screenshots saved to a trip, read for places like a photo post
    op.create_table(
        'link_images',
        sa.Column('link_id', sa.Integer(), nullable=False),
        sa.Column('content_type', sa.String(length=30), nullable=False),
        sa.Column('data', sa.LargeBinary(), nullable=False),
        sa.ForeignKeyConstraint(['link_id'], ['saved_links.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('link_id')
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('link_images')
