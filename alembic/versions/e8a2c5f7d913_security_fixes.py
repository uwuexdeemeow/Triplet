"""security fixes: signed photo addresses, no outside photo links, guest code lockout

Revision ID: e8a2c5f7d913
Revises: d3f6b8a1c925
Create Date: 2026-10-02 18:00:00.000000

"""
import re
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

import avatars


# revision identifiers, used by Alembic.
revision: str = 'e8a2c5f7d913'
down_revision: Union[str, Sequence[str], None] = 'd3f6b8a1c925'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

OUR_PHOTO = re.compile(r"^/users/(\d+)/avatar\?v=([0-9a-f]{12})$")


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('trip_guest_access', sa.Column('failed_pins', sa.Integer(), server_default='0', nullable=False))
    op.add_column('trip_guest_access', sa.Column('locked_at', sa.DateTime(timezone=True), nullable=True))

    # Photos uploaded to Triplet get a signed address; photos linked from other sites are dropped,
    # since showing them would tell that site the address of everyone who looked
    connection = op.get_bind()
    users = sa.table('users', sa.column('id', sa.Integer), sa.column('avatar_url', sa.Text))
    for user_id, url in connection.execute(sa.select(users.c.id, users.c.avatar_url).where(users.c.avatar_url.is_not(None))):
        match = OUR_PHOTO.match(url)
        new_url = avatars.photo_path(int(match.group(1)), match.group(2)) if match and int(match.group(1)) == user_id else None
        if url.startswith(f"/users/{user_id}/avatar?") and "&sig=" in url:
            continue
        connection.execute(users.update().where(users.c.id == user_id).values(avatar_url=new_url))


def downgrade() -> None:
    """Downgrade schema."""
    # Signed addresses still work after downgrading, as the old code ignores the extra parameter
    op.drop_column('trip_guest_access', 'locked_at')
    op.drop_column('trip_guest_access', 'failed_pins')
