"""trip appearance, cover photos and avatar buddies

Revision ID: f7b2d9e4a618
Revises: e8a2c5f7d913
Create Date: 2026-10-02 22:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f7b2d9e4a618'
down_revision: Union[str, Sequence[str], None] = 'e8a2c5f7d913'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Empty means every choice is the default, so existing trips need nothing filled in
    op.add_column('trips', sa.Column('appearance', sa.JSON(), server_default='{}', nullable=False))
    op.add_column('trips', sa.Column('cover_url', sa.String(length=500), nullable=True))
    op.add_column('users', sa.Column('avatar_buddy', sa.String(length=20), nullable=True))
    # Cover photos for the "photo" style, served by GET /trips/{id}/cover
    op.create_table(
        'trip_covers',
        sa.Column('trip_id', sa.Integer(), nullable=False),
        sa.Column('content_type', sa.String(length=30), nullable=False),
        sa.Column('data', sa.LargeBinary(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['trip_id'], ['trips.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('trip_id')
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('trip_covers')
    op.drop_column('users', 'avatar_buddy')
    op.drop_column('trips', 'cover_url')
    op.drop_column('trips', 'appearance')
