"""merge the share link into guest access

Revision ID: b8d3a6f2c015
Revises: a7c2f5e91b48
Create Date: 2026-09-30 20:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b8d3a6f2c015'
down_revision: Union[str, Sequence[str], None] = 'a7c2f5e91b48'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('trip_guest_access', sa.Column('show_costs', sa.Boolean(), server_default=sa.false(), nullable=False))
    # Guests could see costs until now, so existing codes keep showing them
    op.execute(sa.text("UPDATE trip_guest_access SET show_costs = :yes").bindparams(yes=True))
    # Share links are replaced by the guest code's own link
    op.drop_table('trip_share_links')


def downgrade() -> None:
    """Downgrade schema."""
    op.create_table(
        'trip_share_links',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('trip_id', sa.Integer(), nullable=False),
        sa.Column('token', sa.String(length=64), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['trip_id'], ['trips.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('trip_id'),
        sa.UniqueConstraint('token'),
    )
    op.drop_column('trip_guest_access', 'show_costs')
