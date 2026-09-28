"""pending signups: only create an account once its email code is entered

Revision ID: f3a9c6d2b710
Revises: e6b3c1d8f027
Create Date: 2026-09-29 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f3a9c6d2b710'
down_revision: Union[str, Sequence[str], None] = 'e6b3c1d8f027'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'pending_signups',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('password', sa.String(length=255), nullable=False),
        sa.Column('signup_token_hash', sa.String(length=64), nullable=False),
        sa.Column('token_hash', sa.String(length=64), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('attempts', sa.Integer(), server_default='0', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('signup_token_hash'),
    )
    op.create_index('ix_pending_signups_email', 'pending_signups', ['email'])

    # Accounts that were never confirmed could never sign in, and they held their email
    # (with whatever password was typed) against the real owner. They can simply sign up again.
    op.execute("DELETE FROM users WHERE email_verified_at IS NULL")


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_pending_signups_email', table_name='pending_signups')
    op.drop_table('pending_signups')
