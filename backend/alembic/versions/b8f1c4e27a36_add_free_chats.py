"""add free chat quota: users.free_chats and trial_usage.kind

Revision ID: b8f1c4e27a36
Revises: a4d2f7c3e915
Create Date: 2026-09-17 10:30:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b8f1c4e27a36'
down_revision: Union[str, Sequence[str], None] = 'a4d2f7c3e915'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # server_default 让已有用户升级后直接拿到对话额度，不用另外发放
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('free_chats', sa.Integer(), server_default='30', nullable=False))
    with op.batch_alter_table('trial_usage', schema=None) as batch_op:
        batch_op.add_column(sa.Column('kind', sa.String(length=16), server_default='search', nullable=False))
        batch_op.create_index(batch_op.f('ix_trial_usage_kind'), ['kind'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('trial_usage', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_trial_usage_kind'))
        batch_op.drop_column('kind')
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_column('free_chats')
