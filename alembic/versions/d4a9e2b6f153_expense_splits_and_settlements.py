"""expense splits and settlements

Revision ID: d4a9e2b6f153
Revises: c3f8a1d7e924
Create Date: 2026-09-30 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4a9e2b6f153'
down_revision: Union[str, Sequence[str], None] = 'c3f8a1d7e924'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Existing expenses stay split between everyone on the trip
    op.add_column('expenses', sa.Column('split', sa.String(length=10), server_default='all', nullable=False))
    op.create_table(
        'expense_shares',
        sa.Column('expense_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('amount', sa.Numeric(10, 2), nullable=False),
        sa.ForeignKeyConstraint(['expense_id'], ['expenses.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('expense_id', 'user_id'),
    )
    op.create_table(
        'settlements',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('trip_id', sa.Integer(), nullable=False),
        sa.Column('from_user_id', sa.Integer(), nullable=True),
        sa.Column('to_user_id', sa.Integer(), nullable=True),
        sa.Column('amount', sa.Numeric(10, 2), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['trip_id'], ['trips.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['from_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['to_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_settlements_trip_id', 'settlements', ['trip_id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_settlements_trip_id', table_name='settlements')
    op.drop_table('settlements')
    op.drop_table('expense_shares')
    op.drop_column('expenses', 'split')
