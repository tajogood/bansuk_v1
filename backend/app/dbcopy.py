"""SQLite 개발 DB의 내용을 PostgreSQL로 옮긴다 (한 번만 쓰는 도구).

    python -m app.dbcopy sqlite:///./bansuk.db

대상은 DATABASE_URL (PostgreSQL). 대상 테이블은 alembic upgrade head로 만들어져 있어야 하고,
비어 있을 때만 옮긴다 (이미 데이터가 있으면 아무것도 하지 않음). 옮긴 뒤 id 시퀀스를 맞춘다.
"""
from __future__ import annotations

import sys

from sqlalchemy import create_engine, func, select, text

from . import models  # noqa: F401
from .db import Base, engine as dst


def copy(src_url: str) -> int:
    src = create_engine(src_url)
    tables = Base.metadata.sorted_tables
    with dst.connect() as d:
        if d.execute(select(func.count()).select_from(models.User.__table__)).scalar():
            print("대상 DB에 이미 데이터가 있어 옮기지 않습니다.")
            return 0
    total = 0
    with src.connect() as s, dst.begin() as d:
        src_tables = set(src.dialect.get_table_names(s))
        for t in tables:
            if t.name not in src_tables:
                continue
            src_cols = {c["name"] for c in src.dialect.get_columns(s, t.name)}
            cols = [c for c in t.columns if c.name in src_cols]
            rows = [dict(r._mapping) for r in s.execute(select(*[t.c[c.name] for c in cols]))]
            if rows:
                d.execute(t.insert(), rows)
                total += len(rows)
                print(f"  {t.name}: {len(rows)}")
        for t in tables:  # PostgreSQL id 시퀀스를 최댓값 다음으로
            pk = list(t.primary_key.columns)
            if len(pk) == 1 and pk[0].autoincrement in (True, "auto") and str(pk[0].type) == "INTEGER":
                d.execute(
                    text(
                        f"SELECT setval(pg_get_serial_sequence('{t.name}', '{pk[0].name}'), "
                        f"COALESCE((SELECT MAX({pk[0].name}) FROM {t.name}), 0) + 1, false)"
                    )
                )
    print(f"SQLite → PostgreSQL {total}행을 옮겼습니다.")
    return total


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("사용법: python -m app.dbcopy sqlite:///./bansuk.db")
    copy(sys.argv[1])
