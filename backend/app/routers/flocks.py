"""계군 관리: 입추 등록, 계사 이동(육성→산란), 출하·도태로 종료, 수정, 마지막 단계 되돌리기.

농장주는 자기 농장만, 반석은 모든 농장. 날짜가 바뀌면 그 계사들의 일일 기록을
맞는 계군에 다시 붙이고 자동 수수를 다시 계산한다 (기록을 먼저 넣고 나중에 입추를 등록해도 된다).
"""
from __future__ import annotations

import datetime as dt
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..audit import audit
from ..db import get_db
from ..models import DailyRecord, Flock, FlockLocation, House, User
from ..security import current_user, require_farm
from ..services.flocks import (
    age_days,
    current_location,
    flock_location_at,
    house_busy,
    last_bird_count,
    relink_records,
)

router = APIRouter(prefix="/api", tags=["flocks"])


def _today() -> dt.date:
    from zoneinfo import ZoneInfo

    from ..settings import LOCAL_TZ

    return dt.datetime.now(ZoneInfo(LOCAL_TZ)).date()


def _flock(db: Session, user: User, flock_id: int) -> Flock:
    f = db.get(Flock, flock_id)
    if not f:
        raise HTTPException(404, "계군을 찾을 수 없습니다")
    require_farm(db, user, f.farm_id)
    return f


def _house(db: Session, farm_id: int, house_id: int) -> House:
    h = db.get(House, house_id)
    if not h or h.farm_id != farm_id:
        raise HTTPException(400, "이 농장의 계사가 아닙니다")
    return h


def _busy_error(db: Session, loc: FlockLocation) -> HTTPException:
    other = db.get(Flock, loc.flock_id)
    house = db.get(House, loc.house_id)
    return HTTPException(
        409,
        detail={
            "code": "house_busy",
            "message": "그 기간에 이 계사에 다른 계군이 있습니다",
            "house": house.name if house else "",
            "placed_on": other.placed_on.isoformat() if other else None,
        },
    )


def _flock_dict(db: Session, f: Flock, today: dt.date, counts: dict[int, int] | None = None) -> dict:
    locs = db.query(FlockLocation).filter(FlockLocation.flock_id == f.id).order_by(FlockLocation.from_date, FlockLocation.id).all()
    houses = {h.id: h for h in db.query(House).filter(House.id.in_([l.house_id for l in locs]))} if locs else {}
    cur = locs[-1] if locs else None
    ref = min(today, f.closed_on) if f.closed_on else today
    last = (
        db.query(DailyRecord)
        .filter(DailyRecord.flock_id == f.id, DailyRecord.bird_count.isnot(None))
        .order_by(DailyRecord.date.desc())
        .first()
    )
    return {
        "id": f.id,
        "name": f.name,
        "placed_on": f.placed_on.isoformat(),
        "placed_count": f.placed_count,
        "breed": f.breed,
        "hatchery": f.hatchery,
        "status": f.status,
        "closed_on": f.closed_on.isoformat() if f.closed_on else None,
        "close_reason": f.close_reason,
        "close_note": f.close_note,
        "program": f.program_name,
        "age_days": age_days(f, ref),
        "current_house": {"id": cur.house_id, "name": houses[cur.house_id].name, "kind": houses[cur.house_id].kind}
        if cur and not f.closed_on
        else None,
        "locations": [
            {
                "id": l.id,
                "house_id": l.house_id,
                "house": houses[l.house_id].name,
                "kind": houses[l.house_id].kind,
                "from": l.from_date.isoformat(),
                "to": l.to_date.isoformat() if l.to_date else None,
                "start_count": l.start_count,
            }
            for l in locs
        ],
        "bird_count": last.bird_count if last else None,
        "bird_count_date": last.date.isoformat() if last else None,
        "records": (counts or {}).get(f.id, 0),
    }


@router.get("/farms/{farm_id}/flock-board")
def flock_board(farm_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """계사별 현재 계군과 계군 목록 (계군 관리 화면)."""
    require_farm(db, user, farm_id)
    today = _today()
    counts = dict(
        db.query(DailyRecord.flock_id, func.count(DailyRecord.id)).filter(DailyRecord.farm_id == farm_id).group_by(DailyRecord.flock_id)
    )
    flocks = db.query(Flock).filter(Flock.farm_id == farm_id).order_by(Flock.placed_on.desc()).all()
    fd = {f.id: _flock_dict(db, f, today, counts) for f in flocks}
    houses = []
    for h in db.query(House).filter(House.farm_id == farm_id, House.active.is_(True)).order_by(House.sort_order, House.id):
        loc = flock_location_at(db, h.id, today)
        houses.append({"id": h.id, "name": h.name, "kind": h.kind, "flock": fd.get(loc.flock_id) if loc else None})
    unlinked = (
        db.query(func.count(DailyRecord.id)).filter(DailyRecord.farm_id == farm_id, DailyRecord.flock_id.is_(None)).scalar()
    )
    return {
        "today": today.isoformat(),
        "houses": houses,
        "active": [fd[f.id] for f in flocks if f.status != "closed"],
        "closed": [fd[f.id] for f in flocks if f.status == "closed"],
        "unlinked_records": unlinked,
    }


class PlaceIn(BaseModel):
    house_id: int
    placed_on: dt.date
    placed_count: int = Field(ge=1, le=2_000_000)
    breed: str | None = Field(default=None, max_length=50)
    hatchery: str | None = Field(default=None, max_length=100)
    name: str | None = Field(default=None, max_length=100)


@router.post("/farms/{farm_id}/flocks")
def place_flock(farm_id: int, body: PlaceIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """입추: 새 계군을 계사에 넣는다."""
    require_farm(db, user, farm_id)
    house = _house(db, farm_id, body.house_id)
    if body.placed_on > _today() + dt.timedelta(days=60):
        raise HTTPException(400, "입추일을 확인해 주세요")
    busy = house_busy(db, house.id, body.placed_on, None)
    if busy:
        raise _busy_error(db, busy)
    f = Flock(
        farm_id=farm_id,
        name=(body.name or "").strip() or None,
        placed_on=body.placed_on,
        placed_count=body.placed_count,
        breed=(body.breed or "").strip() or None,
        hatchery=(body.hatchery or "").strip() or None,
        status="rearing" if house.kind == "rearing" else "laying",
    )
    db.add(f)
    db.flush()
    db.add(FlockLocation(flock_id=f.id, house_id=house.id, from_date=body.placed_on, start_count=body.placed_count))
    db.flush()
    linked = relink_records(db, {house.id}, body.placed_on)
    audit(db, user.id, "flock_placed", target_farm_id=farm_id, detail={"flock_id": f.id, "house": house.name, "linked": linked})
    db.commit()
    return {"flock": _flock_dict(db, f, _today()), "linked_records": linked}


class FlockPatch(BaseModel):
    name: str | None = Field(default=None, max_length=100)
    placed_on: dt.date | None = None
    placed_count: int | None = Field(default=None, ge=1, le=2_000_000)
    breed: str | None = Field(default=None, max_length=50)
    hatchery: str | None = Field(default=None, max_length=100)


@router.patch("/flocks/{flock_id}")
def edit_flock(flock_id: int, body: FlockPatch, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """입추 정보 고치기. 입추일을 바꾸면 첫 계사 기간도 같이 바뀌고 기록을 다시 붙인다."""
    f = _flock(db, user, flock_id)
    locs = db.query(FlockLocation).filter(FlockLocation.flock_id == f.id).order_by(FlockLocation.from_date, FlockLocation.id).all()
    for k in ("name", "breed", "hatchery"):
        v = getattr(body, k)
        if v is not None:
            setattr(f, k, v.strip() or None)
    houses: set[int] = set()
    since = None
    if body.placed_count is not None and body.placed_count != f.placed_count:
        if locs and locs[0].start_count == f.placed_count:
            locs[0].start_count = body.placed_count
        f.placed_count = body.placed_count
        houses.add(locs[0].house_id) if locs else None
        since = f.placed_on
    if body.placed_on is not None and body.placed_on != f.placed_on:
        first = locs[0] if locs else None
        if first:
            end = first.to_date
            if end and body.placed_on > end:
                raise HTTPException(400, "입추일이 다음 계사 이동일보다 늦습니다")
            busy = house_busy(db, first.house_id, body.placed_on, end, exclude_location=first.id)
            if busy:
                raise _busy_error(db, busy)
            since = min(body.placed_on, f.placed_on)
            first.from_date = body.placed_on
            houses.add(first.house_id)
        f.placed_on = body.placed_on
    db.flush()
    linked = relink_records(db, houses, since) if houses else 0
    audit(db, user.id, "flock_updated", target_farm_id=f.farm_id, detail={"flock_id": f.id})
    db.commit()
    return {"flock": _flock_dict(db, f, _today()), "linked_records": linked}


class MoveIn(BaseModel):
    to_house_id: int
    date: dt.date  # 새 계사에 들어간 날
    count: int | None = Field(default=None, ge=1, le=2_000_000)  # 전입 수수 (없으면 마지막 수수)


@router.post("/flocks/{flock_id}/move")
def move_flock(flock_id: int, body: MoveIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """계사 이동 (보통 육성사 → 산란사). 이전 계사는 전날까지로 닫는다."""
    f = _flock(db, user, flock_id)
    if f.status == "closed":
        raise HTTPException(400, "종료된 계군입니다")
    cur = current_location(db, f.id)
    house = _house(db, f.farm_id, body.to_house_id)
    if cur and cur.house_id == house.id:
        raise HTTPException(400, "지금 있는 계사와 같습니다")
    if cur and body.date <= cur.from_date:
        raise HTTPException(400, "이동일은 지금 계사에 들어간 날보다 뒤여야 합니다")
    busy = house_busy(db, house.id, body.date, None)
    if busy:
        raise _busy_error(db, busy)
    count = body.count or last_bird_count(db, f.id, body.date) or f.placed_count
    old_house = cur.house_id if cur else None
    if cur:
        cur.to_date = body.date - dt.timedelta(days=1)
    db.add(FlockLocation(flock_id=f.id, house_id=house.id, from_date=body.date, start_count=count))
    if house.kind == "laying":
        f.status = "laying"
    db.flush()
    linked = relink_records(db, {house.id} | ({old_house} if old_house else set()), body.date - dt.timedelta(days=1))
    audit(db, user.id, "flock_moved", target_farm_id=f.farm_id, detail={"flock_id": f.id, "to": house.name, "count": count})
    db.commit()
    return {"flock": _flock_dict(db, f, _today()), "linked_records": linked}


class CloseIn(BaseModel):
    date: dt.date  # 마지막 날 (이날까지 계사에 있었음)
    reason: Literal["shipped", "culled", "other"] = "shipped"
    note: str | None = Field(default=None, max_length=500)


@router.post("/flocks/{flock_id}/close")
def close_flock(flock_id: int, body: CloseIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """출하·도태로 계군 종료. 그날 이후 계사가 비어 다음 입추를 받을 수 있다."""
    f = _flock(db, user, flock_id)
    if f.status == "closed":
        raise HTTPException(400, "이미 종료된 계군입니다")
    cur = current_location(db, f.id)
    if cur and body.date < cur.from_date:
        raise HTTPException(400, "종료일이 지금 계사에 들어간 날보다 앞섭니다")
    if cur:
        cur.to_date = body.date
    f.status, f.closed_on, f.close_reason, f.close_note = "closed", body.date, body.reason, (body.note or "").strip() or None
    db.flush()
    linked = relink_records(db, {cur.house_id}, body.date) if cur else 0
    audit(db, user.id, "flock_closed", target_farm_id=f.farm_id, detail={"flock_id": f.id, "reason": body.reason})
    db.commit()
    return {"flock": _flock_dict(db, f, _today()), "linked_records": linked}


@router.post("/flocks/{flock_id}/undo")
def undo_last(flock_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """마지막 단계 되돌리기: 종료 취소, 또는 마지막 계사 이동 취소."""
    f = _flock(db, user, flock_id)
    locs = db.query(FlockLocation).filter(FlockLocation.flock_id == f.id).order_by(FlockLocation.from_date, FlockLocation.id).all()
    if not locs:
        raise HTTPException(400, "되돌릴 것이 없습니다")
    cur = locs[-1]
    houses = {cur.house_id}
    if f.status == "closed":
        busy = house_busy(db, cur.house_id, f.closed_on + dt.timedelta(days=1), None, exclude_location=cur.id) if f.closed_on else None
        if busy:
            raise HTTPException(409, "종료 뒤에 이 계사에 다른 계군이 들어와 되돌릴 수 없습니다")
        since = f.closed_on
        cur.to_date = None
        f.status = "laying" if db.get(House, cur.house_id).kind == "laying" else "rearing"
        f.closed_on = f.close_reason = f.close_note = None
        action = "flock_reopened"
    elif len(locs) > 1:
        prev = locs[-2]
        busy = house_busy(db, prev.house_id, cur.from_date, None, exclude_location=prev.id)
        if busy:
            raise HTTPException(409, "이전 계사에 다른 계군이 들어와 되돌릴 수 없습니다")
        since = prev.to_date
        houses.add(prev.house_id)
        db.delete(cur)
        prev.to_date = None
        f.status = "laying" if db.get(House, prev.house_id).kind == "laying" else "rearing"
        action = "flock_move_undone"
    else:
        raise HTTPException(400, "되돌릴 것이 없습니다. 입추를 취소하려면 계군을 지우세요")
    db.flush()
    linked = relink_records(db, houses, since)
    audit(db, user.id, action, target_farm_id=f.farm_id, detail={"flock_id": f.id})
    db.commit()
    return {"flock": _flock_dict(db, f, _today()), "linked_records": linked}


@router.delete("/flocks/{flock_id}")
def delete_flock(flock_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """잘못 등록한 계군 지우기. 붙어 있던 일일 기록은 지우지 않고 계군 연결만 끊는다."""
    f = _flock(db, user, flock_id)
    from ..models import IssuedReport

    if db.query(IssuedReport).filter(IssuedReport.flock_id == f.id).first():
        raise HTTPException(400, "정식 발행된 보고서가 있는 계군은 지울 수 없습니다")
    locs = db.query(FlockLocation).filter(FlockLocation.flock_id == f.id).all()
    houses = {l.house_id for l in locs}
    for l in locs:
        db.delete(l)
    db.flush()
    db.query(DailyRecord).filter(DailyRecord.flock_id == f.id).update({DailyRecord.flock_id: None}, synchronize_session=False)
    from ..models import FlockProgram, NecropsyCase, Vaccination

    if db.query(Vaccination).filter(Vaccination.flock_id == f.id).first():
        raise HTTPException(400, "접종 기록이 있는 계군은 지울 수 없습니다")
    db.query(FlockProgram).filter(FlockProgram.flock_id == f.id).delete(synchronize_session=False)
    db.query(NecropsyCase).filter(NecropsyCase.flock_id == f.id).update({NecropsyCase.flock_id: None}, synchronize_session=False)
    farm_id = f.farm_id
    db.delete(f)
    db.flush()
    relink_records(db, houses)
    audit(db, user.id, "flock_deleted", target_farm_id=farm_id, detail={"flock_id": flock_id})
    db.commit()
    return {"ok": True}
