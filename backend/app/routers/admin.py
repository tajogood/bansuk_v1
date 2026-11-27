"""반석 관리자 전용: 계정과 농장 관리.

계정은 여기서만 만든다 (스스로 가입하는 기능은 없다). 만들거나 비밀번호를 초기화하면
임시 비밀번호(숫자 6자리)를 한 번만 응답에 담아 준다. DB에는 해시만 남는다.
"""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..audit import audit
from ..db import get_db
from ..models import AuditLog, Farm, FarmInputConfig, House, User, UserFarm
from ..security import (
    BANSUK_ROLES,
    ROLE_LABELS,
    admin_user,
    find_user_by_phone,
    now,
    revoke_tokens,
    set_temp_pin,
    valid_phone,
)
from ..importers import FORMATS, LABELS
from ..settings import EGG_GRADES

router = APIRouter(prefix="/api/admin", tags=["admin"])
Role = Literal["admin", "bansuk_vet", "bansuk_staff", "farm_owner"]


# ---------- 계정 ----------

def _status(u: User) -> str:
    if not u.active:
        return "inactive"
    if u.locked_until and u.locked_until > now():
        return "locked"
    if u.must_change_pin:
        return "expired" if u.temp_expires_at and u.temp_expires_at < now() else "temp"
    return "active"


def _user_dict(db: Session, u: User) -> dict:
    farm_ids = [r.farm_id for r in db.query(UserFarm).filter_by(user_id=u.id)]
    return {
        "id": u.id,
        "name": u.name,
        "phone": u.phone,
        "role": u.role,
        "role_label": ROLE_LABELS.get(u.role, u.role),
        "farm_ids": farm_ids,
        "status": _status(u),
        "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
        "temp_expires_at": u.temp_expires_at.isoformat() if u.temp_expires_at else None,
        "created_at": u.created_at.isoformat() if u.created_at else None,
    }


class UserIn(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    phone: str
    role: Role
    farm_ids: list[int] = []


class UserPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=50)
    phone: str | None = None
    role: Role | None = None
    farm_ids: list[int] | None = None
    active: bool | None = None


def _check_farms(db: Session, role: str, farm_ids: list[int]) -> list[int]:
    if role in BANSUK_ROLES:
        return []  # 반석 계정은 모든 농장을 본다
    if not farm_ids:
        raise HTTPException(400, "농장 계정은 농장을 하나 이상 골라야 합니다")
    found = {f.id for f in db.query(Farm).filter(Farm.id.in_(farm_ids))}
    if found != set(farm_ids):
        raise HTTPException(400, "없는 농장이 들어 있습니다")
    return sorted(found)


def _set_farms(db: Session, user_id: int, farm_ids: list[int]) -> None:
    db.query(UserFarm).filter_by(user_id=user_id).delete()
    for fid in farm_ids:
        db.add(UserFarm(user_id=user_id, farm_id=fid))


def _active_admins(db: Session) -> int:
    return db.query(func.count(User.id)).filter(User.role == "admin", User.active.is_(True)).scalar()


@router.get("/users")
def list_users(_: User = Depends(admin_user), db: Session = Depends(get_db)):
    users = db.query(User).order_by(User.role, User.name).all()
    return {"users": [_user_dict(db, u) for u in users], "roles": ROLE_LABELS}


@router.post("/users")
def create_user(body: UserIn, admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    if not valid_phone(body.phone):
        raise HTTPException(400, "휴대폰 번호를 확인해 주세요 (010으로 시작하는 10~11자리)")
    if find_user_by_phone(db, body.phone):
        raise HTTPException(409, "이미 이 번호로 만든 계정이 있습니다")
    farm_ids = _check_farms(db, body.role, body.farm_ids)
    u = User(name=body.name.strip(), role=body.role, created_by=admin.id)
    u.set_phone(body.phone)
    temp = set_temp_pin(u)
    db.add(u)
    db.flush()
    _set_farms(db, u.id, farm_ids)
    audit(db, admin.id, "user_created", target_user_id=u.id, detail={"role": body.role, "farm_ids": farm_ids})
    db.commit()
    return {"user": _user_dict(db, u), "temp_pin": temp}


@router.patch("/users/{user_id}")
def update_user(user_id: int, body: UserPatch, admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(404, "계정이 없습니다")
    changes: dict = {}
    losing_admin = u.role == "admin" and u.active and (
        (body.role is not None and body.role != "admin") or body.active is False
    )
    if losing_admin and _active_admins(db) <= 1:
        raise HTTPException(400, "관리자가 한 명은 남아 있어야 합니다")
    if u.id == admin.id and body.active is False:
        raise HTTPException(400, "자기 계정은 끌 수 없습니다")
    if body.name is not None and body.name != u.name:
        changes["name"] = True
        u.name = body.name.strip()
    if body.phone is not None and body.phone != u.phone:
        if not valid_phone(body.phone):
            raise HTTPException(400, "휴대폰 번호를 확인해 주세요")
        other = find_user_by_phone(db, body.phone)
        if other and other.id != u.id:
            raise HTTPException(409, "이미 이 번호로 만든 계정이 있습니다")
        u.set_phone(body.phone)
        changes["phone"] = True
    role = body.role or u.role
    if body.role is not None and body.role != u.role:
        changes["role"] = [u.role, body.role]
        u.role = body.role
    if body.farm_ids is not None or "role" in changes:
        ids = body.farm_ids if body.farm_ids is not None else [r.farm_id for r in db.query(UserFarm).filter_by(user_id=u.id)]
        farm_ids = _check_farms(db, role, ids)
        _set_farms(db, u.id, farm_ids)
        changes["farm_ids"] = farm_ids
    if body.active is not None and body.active != u.active:
        u.active = body.active
        changes["active"] = body.active
        if not body.active:
            revoke_tokens(db, u.id)
    if changes:
        audit(db, admin.id, "user_updated", target_user_id=u.id, detail=changes)
    db.commit()
    return {"user": _user_dict(db, u)}


@router.post("/users/{user_id}/reset-pin")
def reset_pin(user_id: int, admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(404, "계정이 없습니다")
    temp = set_temp_pin(u)
    revoke_tokens(db, u.id)
    audit(db, admin.id, "pin_reset", target_user_id=u.id)
    db.commit()
    return {"user": _user_dict(db, u), "temp_pin": temp}


@router.post("/users/{user_id}/unlock")
def unlock(user_id: int, admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(404, "계정이 없습니다")
    u.locked_until = None
    u.failed_count = 0
    audit(db, admin.id, "user_unlocked", target_user_id=u.id)
    db.commit()
    return {"user": _user_dict(db, u)}


# ---------- 농장 ----------

class HouseIn(BaseModel):
    id: int | None = None
    name: str = Field(min_length=1, max_length=50)
    kind: Literal["laying", "rearing"] = "laying"
    active: bool = True


class ConfigIn(BaseModel):
    egg_unit: Literal["tray", "egg"] = "tray"
    eggs_per_tray: int = Field(default=30, ge=1, le=100)
    grades: list[str]
    show_feed: bool = True
    show_water: bool = True
    show_temp: bool = True
    show_humidity: bool = True
    show_egg_weight: bool = False
    show_cull: bool = False


class FarmIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    region: str | None = Field(default=None, max_length=100)
    contract_type: Literal["program", "test_only"] = "program"
    active: bool = True
    importer: str | None = None
    lat: float | None = Field(default=None, ge=33, le=39)
    lng: float | None = Field(default=None, ge=124, le=132)
    houses: list[HouseIn] = []
    config: ConfigIn | None = None


def _farm_dict(db: Session, f: Farm) -> dict:
    cfg = f.config
    owners = (
        db.query(User.id, User.name)
        .join(UserFarm, UserFarm.user_id == User.id)
        .filter(UserFarm.farm_id == f.id, User.active.is_(True))
        .all()
    )
    return {
        "id": f.id,
        "name": f.name,
        "region": f.region,
        "contract_type": f.contract_type,
        "active": f.active,
        "importer": f.importer,
        "lat": f.lat,
        "lng": f.lng,
        "houses": [{"id": h.id, "name": h.name, "kind": h.kind, "active": h.active} for h in f.houses],
        "accounts": [{"id": i, "name": n} for i, n in owners],
        "config": {
            "egg_unit": cfg.egg_unit,
            "eggs_per_tray": cfg.eggs_per_tray,
            "grades": cfg.grades,
            **{k: getattr(cfg, k) for k in ("show_feed", "show_water", "show_temp", "show_humidity", "show_egg_weight", "show_cull")},
        }
        if cfg
        else None,
    }


def _apply_houses(db: Session, farm: Farm, houses: list[HouseIn]) -> None:
    existing = {h.id: h for h in farm.houses}
    names = [h.name.strip() for h in houses if h.active]
    if len(names) != len(set(names)):
        raise HTTPException(400, "계사 이름이 겹칩니다")
    for i, h in enumerate(houses):
        if h.id is not None:
            row = existing.get(h.id)
            if not row:
                raise HTTPException(400, "이 농장의 계사가 아닙니다")
            row.name, row.kind, row.active, row.sort_order = h.name.strip(), h.kind, h.active, i
        else:
            db.add(House(farm_id=farm.id, name=h.name.strip(), kind=h.kind, active=h.active, sort_order=i))
    # 목록에서 빠진 계사는 지우지 않고 끈다 (기록이 붙어 있을 수 있음)
    sent = {h.id for h in houses if h.id is not None}
    for hid, row in existing.items():
        if hid not in sent:
            row.active = False


def _apply_config(db: Session, farm: Farm, c: ConfigIn | None) -> None:
    if c is None:
        if not farm.config:
            db.add(FarmInputConfig(farm_id=farm.id))
        return
    bad = [g for g in c.grades if g not in EGG_GRADES]
    if bad or not c.grades:
        raise HTTPException(400, "산란 규격을 확인해 주세요")
    cfg = farm.config or FarmInputConfig(farm_id=farm.id)
    for k, v in c.model_dump().items():
        setattr(cfg, k, v)
    if not farm.config:
        db.add(cfg)


def _check_importer(code: str | None) -> None:
    if code and code not in FORMATS:
        raise HTTPException(400, "등록되지 않은 엑셀 양식입니다")


@router.get("/farms")
def list_farms(_: User = Depends(admin_user), db: Session = Depends(get_db)):
    farms = db.query(Farm).order_by(Farm.active.desc(), Farm.name).all()
    return {
        "farms": [_farm_dict(db, f) for f in farms],
        "grades": {k: v for k, v in EGG_GRADES.items()},
        "importers": LABELS,
    }


@router.post("/farms")
def create_farm(body: FarmIn, admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    if db.query(Farm).filter(func.lower(Farm.name) == body.name.strip().lower()).first():
        raise HTTPException(409, "같은 이름의 농장이 있습니다")
    _check_importer(body.importer)
    f = Farm(name=body.name.strip(), region=body.region, contract_type=body.contract_type, active=body.active, importer=body.importer or None,
             lat=body.lat, lng=body.lng)
    db.add(f)
    db.flush()
    _apply_houses(db, f, body.houses)
    _apply_config(db, f, body.config)
    audit(db, admin.id, "farm_created", target_farm_id=f.id, detail={"houses": len(body.houses)})
    db.commit()
    db.refresh(f)
    return {"farm": _farm_dict(db, f)}


@router.put("/farms/{farm_id}")
def update_farm(farm_id: int, body: FarmIn, admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    f = db.get(Farm, farm_id)
    if not f:
        raise HTTPException(404, "농장이 없습니다")
    dup = db.query(Farm).filter(func.lower(Farm.name) == body.name.strip().lower(), Farm.id != f.id).first()
    if dup:
        raise HTTPException(409, "같은 이름의 농장이 있습니다")
    _check_importer(body.importer)
    f.name, f.region, f.contract_type, f.active = body.name.strip(), body.region, body.contract_type, body.active
    f.importer = body.importer or None
    f.lat, f.lng = body.lat, body.lng
    _apply_houses(db, f, body.houses)
    _apply_config(db, f, body.config)
    audit(db, admin.id, "farm_updated", target_farm_id=f.id)
    db.commit()
    db.refresh(f)
    return {"farm": _farm_dict(db, f)}


# ---------- 기록 ----------

ACTION_LABELS = {
    "admin_bootstrap": "초기 관리자 생성",
    "user_created": "계정 생성",
    "user_updated": "계정 수정",
    "pin_reset": "비밀번호 초기화",
    "pin_set": "첫 비밀번호 설정",
    "pin_changed": "비밀번호 변경",
    "user_unlocked": "잠금 해제",
    "login_locked": "로그인 잠김",
    "farm_created": "농장 생성",
    "farm_updated": "농장 수정",
    "vaccine_saved": "백신 저장",
    "program_saved": "백신 프로그램 저장",
    "program_version": "백신 프로그램 새 버전",
    "program_assigned": "계군 프로그램 적용",
    "vaccination_added": "접종 기록",
    "vaccination_deleted": "접종 기록 삭제",
    "lab_created": "검사 결과 입력",
    "lab_updated": "검사 결과 수정",
    "lab_issued": "검사 결과 발행",
    "lab_unissued": "검사 결과 발행 취소",
    "lab_deleted": "검사 결과 삭제",
    "lab_imported": "성적서 파일 올림",
    "photos_archived": "지난 부검 사진 올림",
    "labels_exported": "사진 학습 데이터 내보냄",
    "import_applied": "엑셀 업로드 반영",
    "import_reverted": "엑셀 업로드 되돌림",
    "flock_placed": "입추 등록",
    "flock_updated": "계군 수정",
    "flock_moved": "계사 이동",
    "flock_closed": "계군 종료",
    "flock_reopened": "계군 종료 취소",
    "flock_move_undone": "계사 이동 취소",
    "flock_deleted": "계군 삭제",
}


@router.get("/audit")
def audit_log(limit: int = 100, _: User = Depends(admin_user), db: Session = Depends(get_db)):
    rows = db.query(AuditLog).order_by(AuditLog.id.desc()).limit(min(limit, 500)).all()
    names = {u.id: u.name for u in db.query(User.id, User.name)}
    farms = {f.id: f.name for f in db.query(Farm.id, Farm.name)}
    return {
        "items": [
            {
                "at": r.at.isoformat() if r.at else None,
                "actor": names.get(r.actor_id) if r.actor_id else None,
                "action": ACTION_LABELS.get(r.action, r.action),
                "target": names.get(r.target_user_id) or farms.get(r.target_farm_id) or "",
            }
            for r in rows
        ]
    }
