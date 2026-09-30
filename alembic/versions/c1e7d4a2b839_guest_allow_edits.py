"""let guests add and change plans

Revision ID: c1e7d4a2b839
Revises: b8d3a6f2c015
Create Date: 2026-09-30 22:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c1e7d4a2b839'
down_revision: Union[str, Sequence[str], None] = 'b8d3a6f2c015'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('trip_guest_access', sa.Column('allow_edits', sa.Boolean(), server_default=sa.false(), nullable=False))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('trip_guest_access', 'allow_edits')
