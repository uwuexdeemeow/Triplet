"""email codes: count wrong attempts on verification and reset codes

Revision ID: e6b3c1d8f027
Revises: d2f7a9c4e815
Create Date: 2026-09-28 22:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e6b3c1d8f027'
down_revision: Union[str, Sequence[str], None] = 'd2f7a9c4e815'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Emailed codes lock after a few wrong tries
    op.add_column('email_verification_tokens', sa.Column('attempts', sa.Integer(), server_default='0', nullable=False))
    op.add_column('password_reset_tokens', sa.Column('attempts', sa.Integer(), server_default='0', nullable=False))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('password_reset_tokens', 'attempts')
    op.drop_column('email_verification_tokens', 'attempts')
