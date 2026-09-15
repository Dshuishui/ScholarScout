"""add trial_usage table for anonymous free searches

Revision ID: a4d2f7c3e915
Revises: 7c1e4b9a2d10
Create Date: 2026-09-15 23:40:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a4d2f7c3e915'
down_revision: Union[str, Sequence[str], None] = '7c1e4b9a2d10'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'trial_usage',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('device_hash', sa.String(length=64), nullable=False),
        sa.Column('ip_hash', sa.String(length=64), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('trial_usage', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_trial_usage_device_hash'), ['device_hash'], unique=False)
        batch_op.create_index(batch_op.f('ix_trial_usage_ip_hash'), ['ip_hash'], unique=False)
        batch_op.create_index(batch_op.f('ix_trial_usage_created_at'), ['created_at'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('trial_usage', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_trial_usage_created_at'))
        batch_op.drop_index(batch_op.f('ix_trial_usage_ip_hash'))
        batch_op.drop_index(batch_op.f('ix_trial_usage_device_hash'))
    op.drop_table('trial_usage')
