"""email verification and invites by email

Revision ID: c8a4f0e2b913
Revises: b5e2d8f41c07
Create Date: 2026-09-28 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c8a4f0e2b913'
down_revision: Union[str, Sequence[str], None] = 'b5e2d8f41c07'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('users', sa.Column('email_verified_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('users', sa.Column('pending_email', sa.String(length=255), nullable=True))
    # Accounts from before verification existed keep working
    op.execute("UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL")

    op.create_table(
        'email_verification_tokens',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('token_hash', sa.String(length=64), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('token_hash'),
    )

    # Invitations can now be for an email that has no account yet
    op.add_column('trip_invitations', sa.Column('email', sa.String(length=255), nullable=True))
    op.alter_column('trip_invitations', 'user_id', existing_type=sa.Integer(), nullable=True)
    op.execute(
        "UPDATE trip_invitations SET email = users.email FROM users "
        "WHERE trip_invitations.user_id = users.id AND trip_invitations.email IS NULL"
    )
    op.create_unique_constraint('uq_invitation_email_trip', 'trip_invitations', ['email', 'trip_id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('uq_invitation_email_trip', 'trip_invitations', type_='unique')
    # Invites to people without an account can't be kept once user_id is required again
    op.execute("DELETE FROM trip_invitations WHERE user_id IS NULL")
    op.alter_column('trip_invitations', 'user_id', existing_type=sa.Integer(), nullable=False)
    op.drop_column('trip_invitations', 'email')
    op.drop_table('email_verification_tokens')
    op.drop_column('users', 'pending_email')
    op.drop_column('users', 'email_verified_at')
