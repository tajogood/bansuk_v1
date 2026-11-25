"""농장주 일일 입력 API.

GET  /api/farms/{farm_id}/day?date=YYYY-MM-DD   그날 입력 화면에 필요한 모든 것 (한 번의 요청)
PUT  /api/farms/{farm_id}/houses/{house_id}/daily/{date}   한 동 저장 → 계산 지표 + 경고 반환
GET  /api/farms/{farm_id}/daily?start=&end=   기간 기록 (대시보드용)
"""
import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import DailyRecord, Farm, Flock, House, User
from ..schemas import DailyIn
from ..security import current_user, require_farm
from ..serialize import config_dict, record_dict
from ..services import daily as daily_svc
from ..services.flocks import age_label, flock_location_at, starting_count
from ..services.metrics import compute, warnings

router = APIRouter(prefix="/api/farms", tags=["daily"])


def _farm(db: Session, user: User, farm_id: int) -> Farm:
    require_farm(db, user, farm_id)
    farm = db.get(Farm, farm_id)
    if not farm:
        raise HTTPException(404, "농장을 찾을 수 없습니다")
    return farm


def _house_view(db: Session, house: House, day: dt.date) -> dict:
    loc = flock_location_at(db, house.id, day)
    flock = db.get(Flock, loc.flock_id) if loc else None
    rec = daily_svc.get_record(db, house.id, day)
    hist = daily_svc.history(db, house.id, day, days=14)
    prev = hist[-1] if hist else None
    lay7 = [compute(h)["lay_rate"] for h in hist[-7:]]
    lay7 = [x for x in lay7 if x is not None and x <= 100]
    expected_count = None
    if prev and prev.bird_count is not None:
        expected_count = prev.bird_count
    elif loc:
        expected_count = starting_count(db, loc)
    return {
        "house": {"id": house.id, "name": house.name, "kind": house.kind},
        "flock": (
            {"id": flock.id, "name": flock.name, "breed": flock.breed, **age_label(flock, day)}
            if flock
            else None
        ),
        "record": record_dict(rec),
        "previous": record_dict(prev),
        "expected_start_count": expected_count,
        "lay_rate_7d_avg": round(sum(lay7) / len(lay7), 1) if lay7 else None,
        "warnings": warnings(rec, hist) if rec else [],
    }


@router.get("/{farm_id}/day")
def day_view(
    farm_id: int,
    date: dt.date | None = Query(default=None),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    farm = _farm(db, user, farm_id)
    day = date or dt.date.today()
    houses = [h for h in farm.houses if h.active]
    views = [_house_view(db, h, day) for h in houses]
    done = sum(1 for v in views if v["record"])
    return {
        "farm": {"id": farm.id, "name": farm.name},
        "date": day.isoformat(),
        "config": config_dict(farm),
        "houses": views,
        "progress": {"done": done, "total": len(views)},
    }


@router.put("/{farm_id}/houses/{house_id}/daily/{date}")
def save_daily(
    farm_id: int,
    house_id: int,
    date: dt.date,
    body: DailyIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    _farm(db, user, farm_id)
    house = db.get(House, house_id)
    if not house or house.farm_id != farm_id:
        raise HTTPException(404, "계사를 찾을 수 없습니다")
    if date > dt.date.today() + dt.timedelta(days=1):
        raise HTTPException(400, "미래 날짜는 입력할 수 없습니다")
    values = body.model_dump(exclude_unset=True)
    daily_svc.upsert(db, house, date, values, user.id)
    return _house_view(db, house, date)


@router.get("/{farm_id}/daily")
def list_daily(
    farm_id: int,
    start: dt.date,
    end: dt.date,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    _farm(db, user, farm_id)
    if (end - start).days > 800:
        raise HTTPException(400, "기간은 800일 이내로 조회해 주세요")
    rows = (
        db.query(DailyRecord)
        .filter(DailyRecord.farm_id == farm_id, DailyRecord.date.between(start, end))
        .order_by(DailyRecord.house_id, DailyRecord.date)
        .all()
    )
    return {"records": [record_dict(r) for r in rows]}
