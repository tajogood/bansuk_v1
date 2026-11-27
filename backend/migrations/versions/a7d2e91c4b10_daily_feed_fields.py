"""daily record: 사료 입고·회사·종류, 외기온도, 균일도

Revision ID: a7d2e91c4b10
Revises: f35b1b1c192f
Create Date: 2026-11-27 16:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "a7d2e91c4b10"
down_revision: Union[str, Sequence[str], None] = "f35b1b1c192f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

COLS = [
    ("out_temp_min", sa.Float()),
    ("out_temp_max", sa.Float()),
    ("uniformity", sa.Float()),
    ("feed_in_kg", sa.Float()),
    ("feed_brand", sa.String(length=40)),
    ("feed_type", sa.String(length=40)),
]


def upgrade() -> None:
    with op.batch_alter_table("daily_record") as b:
        for name, typ in COLS:
            b.add_column(sa.Column(name, typ, nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("daily_record") as b:
        for name, _ in COLS:
            b.drop_column(name)
