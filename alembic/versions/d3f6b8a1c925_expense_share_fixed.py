"""remember which expense shares were typed in

Revision ID: d3f6b8a1c925
Revises: c9e4a7d2f518
Create Date: 2026-10-02 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd3f6b8a1c925'
down_revision: Union[str, Sequence[str], None] = 'c9e4a7d2f518'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('expense_shares', sa.Column('fixed', sa.Boolean(), server_default=sa.false(), nullable=False))
    # Shares of expenses split by amounts were all typed in
    op.execute(
        "UPDATE expense_shares SET fixed = true "
        "WHERE expense_id IN (SELECT id FROM expenses WHERE split = 'amounts')"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('expense_shares', 'fixed')
