"""user identities: sign in with Google or Apple

Revision ID: b7e2f4a9c1d6
Revises: a1d4e7b92c35
Create Date: 2026-09-29 20:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b7e2f4a9c1d6'
down_revision: Union[str, Sequence[str], None] = 'a1d4e7b92c35'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'user_identities',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('provider', sa.String(length=20), nullable=False),
        sa.Column('subject', sa.String(length=255), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('provider', 'subject', name='uq_identity_provider_subject'),
    )
    op.create_index('ix_user_identities_user_id', 'user_identities', ['user_id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_user_identities_user_id', table_name='user_identities')
    op.drop_table('user_identities')
