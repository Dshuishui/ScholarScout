"""add users.token_version for revoking login tokens

Revision ID: 7c1e4b9a2d10
Revises: 33266138fe5e
Create Date: 2026-09-15 18:40:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '7c1e4b9a2d10'
down_revision: Union[str, Sequence[str], None] = '33266138fe5e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # server_default 让已有用户直接得到 0，与未带版本号的旧凭证匹配，上线不会把现有用户踢下线
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('token_version', sa.Integer(), server_default='0', nullable=False))


def downgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_column('token_version')
