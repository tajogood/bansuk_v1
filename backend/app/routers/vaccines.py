"""백신 마스터, 프로그램, 계군 적용, 접종 기록.

반석: 모두 관리 (반석이 직접 접종). 농장: 자기 계군의 프로그램·일정·접종 기록 보기.
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
from ..models import Flock, FlockProgram, ProgramItem, User, Vaccination, Vaccine, VaccineProgram
from ..security import BANSUK_ROLES, accessible_farm_ids, current_user, require_farm
from ..services import vaccines as svc
from ..services.flocks import age_days

router = APIRouter(prefix="/api", tags=["vaccines"])

Kind = Literal["live", "inactivated", "vector", "other"]
Route = Literal["spray", "drinking", "eye_drop", "nasal", "injection_im", "injection_sc", "wing_web", "in_ovo", "other"]


def _bansuk(user: User = Depends(current_user)) -> User:
    if user.role not in BANSUK_ROLES:
        raise HTTPException(403, "반석 계정만 할 수 있습니다")
    return user


# ---------- 백신 ----------

class Component(BaseModel):
    disease: str = Field(min_length=1, max_length=40)
    strain: str | None = Field(default=None, max_length=80)


class VaccineIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    maker: str | None = Field(default=None, max_length=100)
    kind: Kind = "live"
    route: Route = "spray"
    components: list[Component] = Field(min_length=1, max_length=10)
    note: str | None = Field(default=None, max_length=2000)
    active: bool = True


def _vaccine_dict(v: Vaccine) -> dict:
    return {"id": v.id, "name": v.name, "maker": v.maker, "kind": v.kind, "route": v.route, "components": v.components or [], "note": v.note, "active": v.active}


@router.get("/vaccines")
def list_vaccines(_: User = Depends(_bansuk), db: Session = Depends(get_db)):
    return {"vaccines": [_vaccine_dict(v) for v in db.query(Vaccine).order_by(Vaccine.active.desc(), Vaccine.name)]}


@router.post("/vaccines")
def create_vaccine(body: VaccineIn, user: User = Depends(_bansuk), db: Session = Depends(get_db)):
    v = Vaccine(**{**body.model_dump(), "components": [c.model_dump() for c in body.components]})
    db.add(v)
    db.flush()
    audit(db, user.id, "vaccine_saved", detail={"vaccine_id": v.id})
    db.commit()
    return _vaccine_dict(v)


@router.put("/vaccines/{vaccine_id}")
def update_vaccine(vaccine_id: int, body: VaccineIn, user: User = Depends(_bansuk), db: Session = Depends(get_db)):
    v = db.get(Vaccine, vaccine_id)
    if not v:
        raise HTTPException(404, "백신을 찾을 수 없습니다")
    for k, val in body.model_dump().items():
        setattr(v, k, val)
    v.components = [c.model_dump() for c in body.components]
    audit(db, user.id, "vaccine_saved", detail={"vaccine_id": v.id})
    db.commit()
    return _vaccine_dict(v)


# ---------- 프로그램 ----------

class ItemIn(BaseModel):
    age_days: int = Field(ge=0, le=1200)
    vaccine_id: int
    route: Route | None = None
    note: str | None = Field(default=None, max_length=300)


class ProgramIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=3000)
    active: bool = True
    items: list[ItemIn] = Field(default_factory=list, max_length=120)


def _in_use(db: Session, program_id: int) -> int:
    return db.query(func.count(func.distinct(FlockProgram.flock_id))).filter(FlockProgram.program_id == program_id).scalar()


def _program_dict(db: Session, p: VaccineProgram, items: bool = False) -> dict:
    d = {
        "id": p.id,
        "name": p.name,
        "version": p.version,
        "label": p.label,
        "based_on_id": p.based_on_id,
        "description": p.description,
        "active": p.active,
        "flocks": _in_use(db, p.id),
        "item_count": db.query(func.count(ProgramItem.id)).filter(ProgramItem.program_id == p.id).scalar(),
    }
    if items:
        vac = {v.id: v for v in db.query(Vaccine)}
        d["items"] = [
            {
                "id": it.id,
                "age_days": it.age_days,
                "vaccine_id": it.vaccine_id,
                "vaccine": vac[it.vaccine_id].name if it.vaccine_id in vac else "",
                "kind": vac[it.vaccine_id].kind if it.vaccine_id in vac else None,
                "route": it.route,
                "default_route": vac[it.vaccine_id].route if it.vaccine_id in vac else None,
                "note": it.note,
            }
            for it in db.query(ProgramItem).filter(ProgramItem.program_id == p.id).order_by(ProgramItem.age_days, ProgramItem.sort_order)
        ]
    return d


def _set_items(db: Session, p: VaccineProgram, items: list[ItemIn]) -> None:
    ids = {i.vaccine_id for i in items}
    if ids and db.query(func.count(Vaccine.id)).filter(Vaccine.id.in_(ids)).scalar() != len(ids):
        raise HTTPException(400, "없는 백신이 들어 있습니다")
    db.query(ProgramItem).filter(ProgramItem.program_id == p.id).delete()
    for i, it in enumerate(sorted(items, key=lambda x: x.age_days)):
        db.add(ProgramItem(program_id=p.id, age_days=it.age_days, vaccine_id=it.vaccine_id, route=it.route, note=it.note, sort_order=i))


@router.get("/programs")
def list_programs(user: User = Depends(_bansuk), db: Session = Depends(get_db)):
    ps = db.query(VaccineProgram).order_by(VaccineProgram.active.desc(), VaccineProgram.name, VaccineProgram.version.desc()).all()
    return {"programs": [_program_dict(db, p) for p in ps]}


@router.get("/programs/{program_id}")
def get_program(program_id: int, user: User = Depends(_bansuk), db: Session = Depends(get_db)):
    p = db.get(VaccineProgram, program_id)
    if not p:
        raise HTTPException(404, "프로그램을 찾을 수 없습니다")
    return _program_dict(db, p, items=True)


@router.post("/programs")
def create_program(body: ProgramIn, user: User = Depends(_bansuk), db: Session = Depends(get_db)):
    p = VaccineProgram(name=body.name.strip(), description=body.description, active=body.active, version=1, created_by=user.id)
    db.add(p)
    db.flush()
    _set_items(db, p, body.items)
    audit(db, user.id, "program_saved", detail={"program_id": p.id})
    db.commit()
    return _program_dict(db, p, items=True)


@router.put("/programs/{program_id}")
def update_program(program_id: int, body: ProgramIn, user: User = Depends(_bansuk), db: Session = Depends(get_db)):
    """적용된 계군이 없을 때만 그대로 고친다. 적용 중이면 일정은 새 버전으로 (이름·설명·사용 여부는 고칠 수 있음)."""
    p = db.get(VaccineProgram, program_id)
    if not p:
        raise HTTPException(404, "프로그램을 찾을 수 없습니다")
    used = _in_use(db, p.id)
    current = [(i.age_days, i.vaccine_id, i.route, i.note) for i in db.query(ProgramItem).filter(ProgramItem.program_id == p.id).order_by(ProgramItem.age_days, ProgramItem.sort_order)]
    incoming = [(i.age_days, i.vaccine_id, i.route, i.note) for i in sorted(body.items, key=lambda x: x.age_days)]
    if used and current != incoming:
        raise HTTPException(409, detail={"code": "program_in_use", "message": "계군에 적용된 프로그램이라 일정을 바꾸려면 새 버전으로 저장해야 합니다", "flocks": used})
    p.name, p.description, p.active = body.name.strip(), body.description, body.active
    if not used:
        _set_items(db, p, body.items)
    for f in db.query(Flock).join(FlockProgram, FlockProgram.flock_id == Flock.id).filter(FlockProgram.program_id == p.id, FlockProgram.to_date.is_(None)):
        f.program_name = p.label
    audit(db, user.id, "program_saved", detail={"program_id": p.id})
    db.commit()
    return _program_dict(db, p, items=True)


@router.post("/programs/{program_id}/new-version")
def new_version(program_id: int, body: ProgramIn, user: User = Depends(_bansuk), db: Session = Depends(get_db)):
    base = db.get(VaccineProgram, program_id)
    if not base:
        raise HTTPException(404, "프로그램을 찾을 수 없습니다")
    top = db.query(func.max(VaccineProgram.version)).filter(VaccineProgram.name == base.name).scalar() or base.version
    p = VaccineProgram(name=base.name, version=top + 1, based_on_id=base.id, description=body.description, active=True, created_by=user.id)
    db.add(p)
    db.flush()
    _set_items(db, p, body.items)
    audit(db, user.id, "program_version", detail={"program_id": p.id, "from": base.id})
    db.commit()
    return _program_dict(db, p, items=True)


# ---------- 계군 적용 · 접종 ----------

def _flock(db: Session, user: User, flock_id: int) -> Flock:
    f = db.get(Flock, flock_id)
    if not f:
        raise HTTPException(404, "계군을 찾을 수 없습니다")
    require_farm(db, user, f.farm_id)
    return f


def _vaccination_dict(v: Vaccination, vac: dict, names: dict, houses: dict) -> dict:
    vv = vac.get(v.vaccine_id)
    return {
        "id": v.id,
        "date": v.date.isoformat(),
        "vaccine": {"id": vv.id, "name": vv.name, "kind": vv.kind} if vv else None,
        "route": v.route or (vv.route if vv else None),
        "birds": v.birds,
        "lot": v.lot,
        "program_item_id": v.program_item_id,
        "performed_by": names.get(v.performed_by),
        "house": houses.get(v.house_id),
        "note": v.note,
    }


@router.get("/flocks/{flock_id}/vaccination")
def flock_vaccination(flock_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    f = _flock(db, user, flock_id)
    from ..models import Farm, House

    today = svc.local_today()
    progs = {p.id: p for p in db.query(VaccineProgram)}
    names = {u.id: u.name for u in db.query(User.id, User.name)}
    vac = {v.id: v for v in db.query(Vaccine)}
    houses = {h.id: h.name for h in db.query(House).filter(House.farm_id == f.farm_id)}
    assigns = db.query(FlockProgram).filter(FlockProgram.flock_id == f.id).order_by(FlockProgram.from_date, FlockProgram.id).all()
    cur = svc.current_assignment(db, f.id)
    farm = db.get(Farm, f.farm_id)
    return {
        "flock": {
            "id": f.id,
            "name": f.name,
            "placed_on": f.placed_on.isoformat(),
            "placed_count": f.placed_count,
            "status": f.status,
            "age_days": age_days(f, min(today, f.closed_on) if f.closed_on else today),
            "farm": {"id": farm.id, "name": farm.name} if farm else None,
            "closed_on": f.closed_on.isoformat() if f.closed_on else None,
        },
        "current": {"program_id": cur.program_id, "label": progs[cur.program_id].label if cur.program_id in progs else None, "from": cur.from_date.isoformat()} if cur else None,
        "history": [
            {
                "id": a.id,
                "program_id": a.program_id,
                "label": progs[a.program_id].label if a.program_id in progs else None,
                "from": a.from_date.isoformat(),
                "to": a.to_date.isoformat() if a.to_date else None,
                "reason": a.reason,
                "set_by": names.get(a.set_by),
            }
            for a in assigns
        ],
        "schedule": svc.schedule(db, f, today),
        "vaccinations": [
            _vaccination_dict(v, vac, names, houses)
            for v in db.query(Vaccination).filter(Vaccination.flock_id == f.id).order_by(Vaccination.date.desc(), Vaccination.id.desc())
        ],
        "can_edit": user.role in BANSUK_ROLES,
    }


class AssignIn(BaseModel):
    program_id: int | None = None  # None = 프로그램 중단
    from_date: dt.date
    reason: str | None = Field(default=None, max_length=500)


@router.post("/flocks/{flock_id}/program")
def set_program(flock_id: int, body: AssignIn, user: User = Depends(_bansuk), db: Session = Depends(get_db)):
    f = _flock(db, user, flock_id)
    prog = None
    if body.program_id is not None:
        prog = db.get(VaccineProgram, body.program_id)
        if not prog:
            raise HTTPException(400, "프로그램을 찾을 수 없습니다")
    if body.from_date < f.placed_on:
        raise HTTPException(400, "입추일보다 앞선 날짜입니다")
    try:
        svc.assign(db, f, prog, body.from_date, body.reason, user.id)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    audit(db, user.id, "program_assigned", target_farm_id=f.farm_id, detail={"flock_id": f.id, "program_id": body.program_id})
    db.commit()
    return flock_vaccination(flock_id, user, db)


class VaccinationIn(BaseModel):
    date: dt.date
    vaccine_id: int
    route: Route | None = None
    birds: int | None = Field(default=None, ge=0, le=2_000_000)
    lot: str | None = Field(default=None, max_length=60)
    program_item_id: int | None = None
    performed_by: int | None = None
    note: str | None = Field(default=None, max_length=500)


@router.post("/flocks/{flock_id}/vaccinations")
def add_vaccination(flock_id: int, body: VaccinationIn, user: User = Depends(_bansuk), db: Session = Depends(get_db)):
    f = _flock(db, user, flock_id)
    if not db.get(Vaccine, body.vaccine_id):
        raise HTTPException(400, "백신을 찾을 수 없습니다")
    if body.date < f.placed_on or body.date > svc.local_today() + dt.timedelta(days=1):
        raise HTTPException(400, "접종일을 확인해 주세요")
    if body.program_item_id is not None:
        it = db.get(ProgramItem, body.program_item_id)
        if not it:
            raise HTTPException(400, "프로그램 항목을 찾을 수 없습니다")
        if db.query(Vaccination).filter(Vaccination.flock_id == f.id, Vaccination.program_item_id == it.id).first():
            raise HTTPException(409, "이 항목은 이미 접종 기록이 있습니다")
    from ..models import FlockLocation

    loc = (
        db.query(FlockLocation)
        .filter(FlockLocation.flock_id == f.id, FlockLocation.from_date <= body.date)
        .order_by(FlockLocation.from_date.desc())
        .first()
    )
    v = Vaccination(
        flock_id=f.id,
        house_id=loc.house_id if loc else None,
        date=body.date,
        vaccine_id=body.vaccine_id,
        route=body.route,
        birds=body.birds,
        lot=(body.lot or "").strip() or None,
        program_item_id=body.program_item_id,
        performed_by=body.performed_by or user.id,
        note=(body.note or "").strip() or None,
        created_by=user.id,
    )
    db.add(v)
    audit(db, user.id, "vaccination_added", target_farm_id=f.farm_id, detail={"flock_id": f.id})
    db.commit()
    return flock_vaccination(flock_id, user, db)


@router.delete("/vaccinations/{vaccination_id}")
def delete_vaccination(vaccination_id: int, user: User = Depends(_bansuk), db: Session = Depends(get_db)):
    v = db.get(Vaccination, vaccination_id)
    if not v:
        raise HTTPException(404, "접종 기록을 찾을 수 없습니다")
    f = _flock(db, user, v.flock_id)
    db.delete(v)
    audit(db, user.id, "vaccination_deleted", target_farm_id=f.farm_id, detail={"flock_id": f.id})
    db.commit()
    return flock_vaccination(f.id, user, db)


@router.get("/vaccination/due")
def due(days: int = 14, user: User = Depends(_bansuk), db: Session = Depends(get_db)):
    """모든 농장의 밀린 접종과 앞으로 N일 안의 접종."""
    return {"items": svc.due_board(db, accessible_farm_ids(db, user), min(max(days, 1), 60)), "today": svc.local_today().isoformat()}


@router.get("/farms/{farm_id}/vaccination/upcoming")
def farm_upcoming(farm_id: int, days: int = 14, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """농장 화면용: 이 농장의 밀린 접종과 앞으로 N일 안의 접종 (농장주도 봄)."""
    require_farm(db, user, farm_id)
    items = svc.due_board(db, {farm_id}, min(max(days, 1), 60))
    return {"items": items, "today": svc.local_today().isoformat()}
