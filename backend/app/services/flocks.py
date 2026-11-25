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
