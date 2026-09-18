"""add site_counters for the weekly summary email

Revision ID: c3a7b95d41e8
Revises: b8f1c4e27a36
Create Date: 2026-09-18 14:30:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c3a7b95d41e8'
down_revision: Union[str, Sequence[str], None] = 'b8f1c4e27a36'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'site_counters',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('day', sa.String(length=10), nullable=False),
        sa.Column('name', sa.String(length=32), nullable=False),
        sa.Column('count', sa.Integer(), nullable=False, server_default='0'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('day', 'name'),
    )
    with op.batch_alter_table('site_counters', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_site_counters_day'), ['day'], unique=False)
        batch_op.create_index(batch_op.f('ix_site_counters_name'), ['name'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('site_counters', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_site_counters_name'))
        batch_op.drop_index(batch_op.f('ix_site_counters_day'))
    op.drop_table('site_counters')
