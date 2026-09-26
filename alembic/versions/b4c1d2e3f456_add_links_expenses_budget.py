"""add saved links, expenses and trip budget

Revision ID: b4c1d2e3f456
Revises: 275d6dae1ab3
Create Date: 2026-09-26 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b4c1d2e3f456'
down_revision: Union[str, Sequence[str], None] = '275d6dae1ab3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('trips', sa.Column('budget', sa.Numeric(precision=12, scale=2), nullable=True))
    op.add_column('trips', sa.Column('currency', sa.String(length=3), server_default='USD', nullable=False))

    op.add_column('trip_invitations', sa.Column('invited_by_id', sa.Integer(), nullable=True))
    op.create_foreign_key(
        'fk_trip_invitations_invited_by_id_users', 'trip_invitations', 'users',
        ['invited_by_id'], ['id'], ondelete='SET NULL'
    )

    op.create_unique_constraint('uq_trip_guest_access_access_code', 'trip_guest_access', ['access_code'])

    op.create_table('saved_links',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('trip_id', sa.Integer(), nullable=False),
    sa.Column('added_by_id', sa.Integer(), nullable=True),
    sa.Column('url', sa.String(length=2048), nullable=False),
    sa.Column('platform', sa.String(length=50), nullable=False),
    sa.Column('title', sa.String(length=500), nullable=True),
    sa.Column('author_name', sa.String(length=255), nullable=True),
    sa.Column('thumbnail_url', sa.String(length=2048), nullable=True),
    sa.Column('place_name', sa.String(length=255), nullable=True),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['trip_id'], ['trips.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['added_by_id'], ['users.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )

    op.add_column('activities', sa.Column('source_link_id', sa.Integer(), nullable=True))
    op.add_column('activities', sa.Column('estimated_cost', sa.Numeric(precision=10, scale=2), nullable=True))
    op.create_foreign_key(
        'fk_activities_source_link_id_saved_links', 'activities', 'saved_links',
        ['source_link_id'], ['id'], ondelete='SET NULL'
    )

    op.create_table('expenses',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('trip_id', sa.Integer(), nullable=False),
    sa.Column('paid_by_id', sa.Integer(), nullable=True),
    sa.Column('activity_id', sa.Integer(), nullable=True),
    sa.Column('title', sa.String(length=255), nullable=False),
    sa.Column('amount', sa.Numeric(precision=10, scale=2), nullable=False),
    sa.Column('category', sa.String(length=50), nullable=False),
    sa.Column('spent_on', sa.Date(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['trip_id'], ['trips.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['paid_by_id'], ['users.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['activity_id'], ['activities.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('expenses')

    op.drop_constraint('fk_activities_source_link_id_saved_links', 'activities', type_='foreignkey')
    op.drop_column('activities', 'estimated_cost')
    op.drop_column('activities', 'source_link_id')

    op.drop_table('saved_links')

    op.drop_constraint('uq_trip_guest_access_access_code', 'trip_guest_access', type_='unique')

    op.drop_constraint('fk_trip_invitations_invited_by_id_users', 'trip_invitations', type_='foreignkey')
    op.drop_column('trip_invitations', 'invited_by_id')

    op.drop_column('trips', 'currency')
    op.drop_column('trips', 'budget')
