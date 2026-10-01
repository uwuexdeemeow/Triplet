"""add flights: into, out of and during a trip

Revision ID: b5d8e1a3c724
Revises: a7c2e9f4b316
Create Date: 2026-10-01 23:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b5d8e1a3c724'
down_revision: Union[str, Sequence[str], None] = 'a7c2e9f4b316'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'flights',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('trip_id', sa.Integer(), nullable=False),
        sa.Column('flight_number', sa.String(20), nullable=True),
        sa.Column('airline', sa.String(100), nullable=True),
        sa.Column('from_name', sa.String(255), nullable=False),
        sa.Column('from_code', sa.String(4), nullable=True),
        sa.Column('from_latitude', sa.Float(), nullable=True),
        sa.Column('from_longitude', sa.Float(), nullable=True),
        sa.Column('to_name', sa.String(255), nullable=False),
        sa.Column('to_code', sa.String(4), nullable=True),
        sa.Column('to_latitude', sa.Float(), nullable=True),
        sa.Column('to_longitude', sa.Float(), nullable=True),
        sa.Column('departs_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('arrives_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('cost', sa.Numeric(12, 2), nullable=True),
        sa.Column('confirmation', sa.String(100), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['trip_id'], ['trips.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_flights_trip_id', 'flights', ['trip_id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_flights_trip_id', table_name='flights')
    op.drop_table('flights')
