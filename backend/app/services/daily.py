"""일일 기록 저장과 수수 자동 계산."""
from __future__ import annotations

import datetime as dt

from sqlalchemy.orm import Session

from ..models import DailyRecord, House
from .flocks import flock_location_at, starting_count

EDITABLE_FIELDS = [
    "mortality",
    "cull",
    "egg_jumbo",
    "egg_xl",
    "egg_l",
    "egg_m",
    "egg_s",
    "egg_double",
    "egg_mudae",
    "egg_muzung",
    "egg_crack",
    "egg_broken",
    "egg_weight",
    "body_weight",
    "feed_kg",
    "water_l",
    "temp_min",
    "temp_max",
    "humidity",
    "out_temp_min",
    "out_temp_max",
    "uniformity",
    "feed_in_kg",
    "feed_brand",
    "feed_type",
    "memo",
]


def get_record(db: Session, house_id: int, day: dt.date) -> DailyRecord | None:
    return db.query(DailyRecord).filter_by(house_id=house_id, date=day).one_or_none()


def history(db: Session, house_id: int, day: dt.date, days: int = 14) -> list[DailyRecord]:
    """해당 날짜 이전 기록 (날짜 오름차순)."""
    rows = (
        db.query(DailyRecord)
        .filter(
            DailyRecord.house_id == house_id,
            DailyRecord.date < day,
            DailyRecord.date >= day - dt.timedelta(days=days),
        )
        .order_by(DailyRecord.date)
        .all()
    )
    return rows


def _previous(db: Session, house_id: int, day: dt.date, flock_id: int | None) -> DailyRecord | None:
    q = db.query(DailyRecord).filter(DailyRecord.house_id == house_id, DailyRecord.date < day)
    if flock_id is not None:
        q = q.filter(DailyRecord.flock_id == flock_id)
    return q.order_by(DailyRecord.date.desc()).first()


def _auto_count(db: Session, rec: DailyRecord) -> int | None:
    prev = _previous(db, rec.house_id, rec.date, rec.flock_id)
    if prev and prev.bird_count is not None:
        base = prev.bird_count
    else:
        loc = flock_location_at(db, rec.house_id, rec.date)
        if not loc:
            return None
        base = starting_count(db, loc)
    return base - (rec.mortality or 0) - (rec.cull or 0)


def recompute_forward(db: Session, house_id: int, from_day: dt.date) -> None:
    """앞 날짜를 고치면 그 뒤 날짜들의 자동 수수를 다시 계산한다.

    _auto_count와 같은 규칙(같은 계군의 전날 수수 - 폐사 - 도태, 전날 수수가 없으면 계사 전입 수수)을
    메모리에서 이어 계산한다 (엑셀 수천 행을 올려도 행마다 DB를 묻지 않게).
    """
    rows = (
        db.query(DailyRecord)
        .filter(DailyRecord.house_id == house_id, DailyRecord.date > from_day)
        .order_by(DailyRecord.date)
        .all()
    )
    prev: dict[int | None, int | None] = {}
    for r in rows:
        key = r.flock_id
        if key not in prev:
            p = _previous(db, house_id, r.date, key)
            prev[key] = p.bird_count if p else None
        if not r.bird_count_manual:
            base = prev[key]
            if base is None:
                loc = flock_location_at(db, house_id, r.date)
                base = starting_count(db, loc) if loc else None
            r.bird_count = None if base is None else base - (r.mortality or 0) - (r.cull or 0)
        prev[key] = r.bird_count
    db.flush()


def upsert(
    db: Session,
    house: House,
    day: dt.date,
    values: dict,
    user_id: int | None,
    source: str = "manual",
) -> DailyRecord:
    rec = get_record(db, house.id, day)
    if rec is None:
        rec = DailyRecord(farm_id=house.farm_id, house_id=house.id, date=day)
        db.add(rec)
    loc = flock_location_at(db, house.id, day)
    rec.flock_id = loc.flock_id if loc else None

    for f in EDITABLE_FIELDS:
        if f in values:
            setattr(rec, f, values[f])

    if values.get("bird_count") is not None:
        rec.bird_count = int(values["bird_count"])
        rec.bird_count_manual = True
    elif not rec.bird_count_manual:
        db.flush()
        rec.bird_count = _auto_count(db, rec)

    rec.source = source
    rec.entered_by = user_id
    db.flush()
    recompute_forward(db, house.id, day)
    db.commit()
    db.refresh(rec)
    return rec
