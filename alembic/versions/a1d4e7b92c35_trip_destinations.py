"""trip destinations: a trip can go to several places, each with a pin

Revision ID: a1d4e7b92c35
Revises: f3a9c6d2b710
Create Date: 2026-09-29 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1d4e7b92c35'
down_revision: Union[str, Sequence[str], None] = 'f3a9c6d2b710'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Existing trips keep their one destination name and start with no places listed
    op.add_column('trips', sa.Column('destinations', sa.JSON(), server_default='[]', nullable=False))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('trips', 'destinations')
