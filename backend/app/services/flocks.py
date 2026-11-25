"""계군 조회와 일령 계산."""
import datetime as dt

from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..models import Flock, FlockLocation
from ..settings import AGE_DAY_BASE


def flock_location_at(db: Session, house_id: int, day: dt.date) -> FlockLocation | None:
    """그날 해당 계사에 있던 계군의 위치 기록."""
    return (
        db.query(FlockLocation)
        .filter(
            FlockLocation.house_id == house_id,
            FlockLocation.from_date <= day,
            or_(FlockLocation.to_date.is_(None), FlockLocation.to_date >= day),
        )
        .order_by(FlockLocation.from_date.desc())
        .first()
    )


def age_days(flock: Flock, day: dt.date) -> int:
    return (day - flock.placed_on).days + AGE_DAY_BASE


def age_label(flock: Flock, day: dt.date) -> dict:
    d = age_days(flock, day)
    return {"age_days": d, "age_weeks": d // 7}


def starting_count(db: Session, loc: FlockLocation) -> int:
    """계사에 들어올 때의 수수. 전입 수수가 없으면 입추 수수."""
    if loc.start_count:
        return loc.start_count
    flock = db.get(Flock, loc.flock_id)
    return flock.placed_count


# ---------------------------------------------------------------------------
# 계군 관리: 입추 · 이동 · 종료 (기록 재연결 포함)
# ---------------------------------------------------------------------------

def house_busy(
    db: Session, house_id: int, start: dt.date, end: dt.date | None, exclude_location: int | None = None
) -> FlockLocation | None:
    """그 기간에 계사를 쓰는 다른 계군이 있으면 그 위치 기록."""
    q = db.query(FlockLocation).filter(
        FlockLocation.house_id == house_id,
        or_(FlockLocation.to_date.is_(None), FlockLocation.to_date >= start),
    )
    if end is not None:
        q = q.filter(FlockLocation.from_date <= end)
    if exclude_location is not None:
        q = q.filter(FlockLocation.id != exclude_location)
    return q.first()


def relink_records(db: Session, house_ids: set[int], since: dt.date | None = None) -> int:
    """계군 날짜가 바뀌면 그 계사들의 일일 기록을 맞는 계군에 다시 붙이고 자동 수수를 다시 계산한다."""
    from ..models import DailyRecord
    from .daily import recompute_forward

    changed = 0
    for hid in house_ids:
        q = db.query(DailyRecord).filter(DailyRecord.house_id == hid)
        if since:
            q = q.filter(DailyRecord.date >= since)
        rows = q.order_by(DailyRecord.date).all()
        if not rows:
            continue
        for r in rows:
            loc = flock_location_at(db, hid, r.date)
            fid = loc.flock_id if loc else None
            if r.flock_id != fid:
                r.flock_id = fid
                changed += 1
        db.flush()
        recompute_forward(db, hid, rows[0].date - dt.timedelta(days=1))
    return changed


def current_location(db: Session, flock_id: int) -> FlockLocation | None:
    return (
        db.query(FlockLocation)
        .filter(FlockLocation.flock_id == flock_id)
        .order_by(FlockLocation.from_date.desc(), FlockLocation.id.desc())
        .first()
    )


def last_bird_count(db: Session, flock_id: int, before: dt.date) -> int | None:
    from ..models import DailyRecord

    r = (
        db.query(DailyRecord)
        .filter(DailyRecord.flock_id == flock_id, DailyRecord.date < before, DailyRecord.bird_count.isnot(None))
        .order_by(DailyRecord.date.desc())
        .first()
    )
    return r.bird_count if r else None
