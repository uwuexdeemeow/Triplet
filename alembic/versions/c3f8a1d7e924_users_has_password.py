"""users.has_password, and undo links for email changes

Revision ID: c3f8a1d7e924
Revises: b7e2f4a9c1d6
Create Date: 2026-09-30 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c3f8a1d7e924'
down_revision: Union[str, Sequence[str], None] = 'b7e2f4a9c1d6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('users', sa.Column('has_password', sa.Boolean(), server_default=sa.true(), nullable=False))
    # Accounts made by signing in with Google or Apple so far: created together with their link
    # (an email account linked later has an older created_at). Ones that have since chosen a
    # password with "Forgot password" keep it.
    op.execute(
        "UPDATE users SET has_password = false "
        "WHERE EXISTS (SELECT 1 FROM user_identities i WHERE i.user_id = users.id "
        "              AND i.created_at <= users.created_at + interval '5 seconds') "
        "AND NOT EXISTS (SELECT 1 FROM password_reset_tokens t WHERE t.user_id = users.id AND t.used_at IS NOT NULL)"
    )

    # The link emailed to the old address when an email changes, to put it back
    op.create_table(
        'email_change_undos',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('old_email', sa.String(length=255), nullable=False),
        sa.Column('token_hash', sa.String(length=64), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('token_hash'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('email_change_undos')
    op.drop_column('users', 'has_password')
