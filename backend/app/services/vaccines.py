"""백신 프로그램: 계군 적용과 접종 일정 계산.

- 계군의 접종 일정 = 적용 기간마다, 그 기간에 예정일이 들어오는 프로그램 항목.
  (중간에 프로그램을 바꾸면 바꾸기 전 항목은 이전 프로그램, 이후 항목은 새 프로그램)
- 예정일 = 입추일 + (항목 일령 - AGE_DAY_BASE)
- 상태: done(접종 기록 있음) / overdue(예정일 지남) / due(7일 안) / upcoming
- Flock.program_name은 분석기·보고서가 읽는 표시용 값이라 적용·변경 때 함께 고친다.
"""
from __future__ import annotations

import datetime as dt

from sqlalchemy.orm import Session

from ..models import Flock, FlockLocation, FlockProgram, House, ProgramItem, Vaccination, Vaccine, VaccineProgram
from ..settings import AGE_DAY_BASE

DUE_DAYS = 7


def local_today() -> dt.date:
    from zoneinfo import ZoneInfo

    from ..settings import LOCAL_TZ

    return dt.datetime.now(ZoneInfo(LOCAL_TZ)).date()


def planned_date(flock: Flock, age_days: int) -> dt.date:
    return flock.placed_on + dt.timedelta(days=age_days - AGE_DAY_BASE)


def current_assignment(db: Session, flock_id: int) -> FlockProgram | None:
    return (
        db.query(FlockProgram)
        .filter(FlockProgram.flock_id == flock_id, FlockProgram.to_date.is_(None))
        .order_by(FlockProgram.from_date.desc(), FlockProgram.id.desc())
        .first()
    )


def assign(db: Session, flock: Flock, program: VaccineProgram | None, from_date: dt.date, reason: str | None, user_id: int) -> FlockProgram:
    """프로그램 적용·변경·중단. 이전 적용은 전날까지로 닫는다."""
    cur = current_assignment(db, flock.id)
    if cur:
        if from_date < cur.from_date:
            raise ValueError("변경일은 지금 프로그램을 적용한 날보다 뒤여야 합니다")
        if from_date == cur.from_date:
            db.delete(cur)  # 같은 날 다시 고르면 바꿔치기
            db.flush()
        else:
            cur.to_date = from_date - dt.timedelta(days=1)
    fp = FlockProgram(flock_id=flock.id, program_id=program.id if program else None, from_date=from_date, reason=reason, set_by=user_id)
    db.add(fp)
    flock.program_name = program.label if program else None
    db.flush()
    return fp


def schedule(db: Session, flock: Flock, today: dt.date | None = None) -> list[dict]:
    today = today or local_today()
    periods = db.query(FlockProgram).filter(FlockProgram.flock_id == flock.id).order_by(FlockProgram.from_date, FlockProgram.id).all()
    done = {v.program_item_id: v for v in db.query(Vaccination).filter(Vaccination.flock_id == flock.id, Vaccination.program_item_id.isnot(None))}
    vaccines = {v.id: v for v in db.query(Vaccine)}
    progs = {p.id: p for p in db.query(VaccineProgram).filter(VaccineProgram.id.in_([p.program_id for p in periods if p.program_id]))} if periods else {}
    out = []
    for per in periods:
        if not per.program_id:
            continue
        items = db.query(ProgramItem).filter(ProgramItem.program_id == per.program_id).order_by(ProgramItem.age_days, ProgramItem.sort_order).all()
        for it in items:
            day = planned_date(flock, it.age_days)
            # 처음 적용한 기간은 그 전 항목도 보여 준다 (입추 뒤 늦게 적용한 경우 확인용)
            first_period = per is periods[0]
            if (day < per.from_date and not first_period) or (per.to_date and day > per.to_date):
                continue
            if flock.closed_on and day > flock.closed_on:
                continue
            v = vaccines.get(it.vaccine_id)
            rec = done.get(it.id)
            if rec:
                status = "done"
            elif day < today:
                status = "overdue"
            elif day <= today + dt.timedelta(days=DUE_DAYS):
                status = "due"
            else:
                status = "upcoming"
            out.append(
                {
                    "item_id": it.id,
                    "program": progs[per.program_id].label if per.program_id in progs else "",
                    "age_days": it.age_days,
                    "planned": day.isoformat(),
                    "vaccine": {"id": v.id, "name": v.name, "kind": v.kind, "components": v.components} if v else None,
                    "route": it.route or (v.route if v else None),
                    "note": it.note,
                    "status": status,
                    "done": {"id": rec.id, "date": rec.date.isoformat(), "lot": rec.lot} if rec else None,
                }
            )
    # 개별 일정 (프로그램과 별개). item_id는 음수로 구분한다.
    from ..models import PlannedVaccination

    done_p = {v.planned_id: v for v in db.query(Vaccination).filter(Vaccination.flock_id == flock.id, Vaccination.planned_id.isnot(None))}
    for p in db.query(PlannedVaccination).filter(PlannedVaccination.flock_id == flock.id):
        if flock.closed_on and p.planned_on > flock.closed_on:
            continue
        v = vaccines.get(p.vaccine_id)
        rec = done_p.get(p.id)
        day = p.planned_on
        status = "done" if rec else "overdue" if day < today else "due" if day <= today + dt.timedelta(days=DUE_DAYS) else "upcoming"
        out.append(
            {
                "item_id": -p.id,
                "planned_id": p.id,
                "program": "개별 일정",
                "age_days": (day - flock.placed_on).days + 1,
                "planned": day.isoformat(),
                "vaccine": {"id": v.id, "name": v.name, "kind": v.kind, "components": v.components} if v else None,
                "route": p.route or (v.route if v else None),
                "note": p.note,
                "status": status,
                "done": {"id": rec.id, "date": rec.date.isoformat(), "lot": rec.lot} if rec else None,
            }
        )
    out.sort(key=lambda x: x["planned"])
    return out


def due_board(db: Session, farm_ids: set[int] | None, days: int = 14) -> list[dict]:
    """여러 농장의 밀린·다가오는 접종 (반석 접종 일정)."""
    today = local_today()
    q = db.query(Flock).filter(Flock.status != "closed")
    if farm_ids is not None:
        q = q.filter(Flock.farm_id.in_(farm_ids))
    from ..models import Farm

    farms = {f.id: f for f in db.query(Farm)}
    out = []
    for f in q:
        from ..models import PlannedVaccination

        if (
            not current_assignment(db, f.id)
            and not db.query(FlockProgram).filter(FlockProgram.flock_id == f.id).first()
            and not db.query(PlannedVaccination).filter(PlannedVaccination.flock_id == f.id).first()
        ):
            continue
        loc = (
            db.query(FlockLocation).filter(FlockLocation.flock_id == f.id).order_by(FlockLocation.from_date.desc()).first()
        )
        house = db.get(House, loc.house_id) if loc else None
        for s in schedule(db, f, today):
            if s["status"] == "overdue" or (s["status"] == "due") or (s["status"] == "upcoming" and s["planned"] <= (today + dt.timedelta(days=days)).isoformat()):
                out.append({**s, "flock_id": f.id, "farm": {"id": f.farm_id, "name": farms[f.farm_id].name}, "house": house.name if house else None, "placed_on": f.placed_on.isoformat()})
    out.sort(key=lambda x: x["planned"])
    return out
