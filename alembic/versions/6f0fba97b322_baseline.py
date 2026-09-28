"""baseline

Revision ID: 6f0fba97b322
Revises: 
Create Date: 2026-08-15 19:29:39.410480

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6f0fba97b322'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # The users table predates migrations, so the next ones change it rather than create it. Make it
    # here, as it was then, so a new database can be built from nothing. Databases that already had
    # it are past this migration and never run it.
    op.create_table(
        'users',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('name', sa.Text(), nullable=False),
        sa.Column('email', sa.Text(), nullable=False),
        sa.Column('password', sa.Text(), nullable=False),
        sa.Column('avatar_url', sa.Text(), nullable=True),
        sa.Column('created_at', sa.Time(timezone=True), nullable=False),
        sa.UniqueConstraint('email', name='email'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('users')
