"""폐사 신고 → 부검 일정 조정 → 부검 결과 공유.

농장: 신고, 반석이 제안한 시간 수락 또는 다른 시간 요청, 메시지, 신고 사진.
반석: 일정 제안·확정, 메시지, 부검 사진, 결과 작성, 농장에 결과 공유.
모든 단계에서 상대편에게 앱 안 알림이 간다.
"""
from __future__ import annotations

import datetime as dt
from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import (
    CaseEvent,
    CasePhoto,
    DailyRecord,
    Farm,
    Flock,
    House,
    NecropsyCase,
    Notification,
    User,
    UserFarm,
)
from ..security import BANSUK_ROLES, accessible_farm_ids, current_user, now, require_farm
from ..services.flocks import age_days, flock_location_at
from ..settings import LOCAL_TZ
from ..storage import check_sig, save_photo, signed_url, storage

router = APIRouter(prefix="/api", tags=["cases"])

OPEN = ("reported", "scheduling", "scheduled")
MAX_PHOTOS_PER_CALL = 30


def is_bansuk(u: User) -> bool:
    return u.role in BANSUK_ROLES


def _get_case(db: Session, user: User, case_id: int) -> NecropsyCase:
    c = db.get(NecropsyCase, case_id)
    if not c:
        raise HTTPException(404, "부검 건을 찾을 수 없습니다")
    require_farm(db, user, c.farm_id)
    return c


def _need_bansuk(user: User) -> None:
    if not is_bansuk(user):
        raise HTTPException(403, "반석 계정만 할 수 있습니다")


def _parse_at(s: str) -> dt.datetime:
    try:
        return dt.datetime.fromisoformat(s).replace(tzinfo=None, second=0, microsecond=0)
    except ValueError as e:
        raise HTTPException(400, "날짜와 시간을 확인해 주세요") from e


# ---------- 알림 ----------

def _bansuk_targets(db: Session, c: NecropsyCase, *, everyone: bool = False) -> list[int]:
    if c.vet_id and not everyone:
        return [c.vet_id]
    return [u.id for u in db.query(User).filter(User.role.in_(BANSUK_ROLES), User.active.is_(True))]


def _farm_targets(db: Session, c: NecropsyCase) -> list[int]:
    return [
        u.id
        for u in db.query(User)
        .join(UserFarm, UserFarm.user_id == User.id)
        .filter(UserFarm.farm_id == c.farm_id, User.active.is_(True), User.role == "farm_owner")
    ]


def _notify(db: Session, c: NecropsyCase, kind: str, to: list[int], actor: User | None, **data) -> None:
    farm = db.get(Farm, c.farm_id)
    house = db.get(House, c.house_id) if c.house_id else None
    base = {"farm": farm.name if farm else "", "house": house.name if house else "", "dead": c.dead_count}
    for uid in set(to):
        if actor and uid == actor.id:
            continue
        db.add(Notification(user_id=uid, case_id=c.id, kind=kind, data={**base, **data, "by": actor.name if actor else ""}))


def _event(db: Session, c: NecropsyCase, kind: str, actor: User | None, **data) -> None:
    db.add(CaseEvent(case_id=c.id, author_id=actor.id if actor else None, kind=kind, data=data or None))


# ---------- 화면용 변환 ----------

def _iso(d: dt.datetime | None) -> str | None:
    """현장 벽시계 시각 (부검 일정 등, 시간대 표시 없음)."""
    return d.isoformat(timespec="minutes") if d else None


def _utc(d: dt.datetime | None) -> str | None:
    """서버가 찍은 UTC 시각 (신고·기록·알림). Z를 붙여 화면이 기기 시간으로 바꾸게 한다."""
    return d.isoformat(timespec="seconds") + "Z" if d else None


def _local_now() -> dt.datetime:
    from zoneinfo import ZoneInfo

    return dt.datetime.now(ZoneInfo(LOCAL_TZ)).replace(tzinfo=None, second=0, microsecond=0)


def _local_date(utc_naive: dt.datetime) -> dt.date:
    """UTC로 저장된 시각의 현장 날짜."""
    from zoneinfo import ZoneInfo

    return utc_naive.replace(tzinfo=dt.timezone.utc).astimezone(ZoneInfo(LOCAL_TZ)).date()


def _production(db: Session, c: NecropsyCase, days: int = 21) -> list[dict]:
    if not c.house_id:
        return []
    end = _local_date(c.reported_at) if c.reported_at else _local_now().date()
    rows = (
        db.query(DailyRecord)
        .filter(DailyRecord.house_id == c.house_id, DailyRecord.date > end - dt.timedelta(days=days), DailyRecord.date <= end)
        .order_by(DailyRecord.date)
        .all()
    )
    out = []
    for r in rows:
        eggs = [r.egg(g) for g in ("jumbo", "xl", "l", "m", "s", "double", "mudae", "muzung", "crack", "broken")]
        total = sum(e or 0 for e in eggs) if any(e is not None for e in eggs) else None
        lay = round(total / r.bird_count * 100, 1) if total is not None and r.bird_count else None
        out.append({"date": r.date.isoformat(), "mortality": r.mortality, "lay_rate": lay if lay is None or lay <= 105 else None})
    return out


def _case_dict(db: Session, c: NecropsyCase, user: User, detail: bool = False) -> dict:
    farm = db.get(Farm, c.farm_id)
    house = db.get(House, c.house_id) if c.house_id else None
    flock = db.get(Flock, c.flock_id) if c.flock_id else None
    vet = db.get(User, c.vet_id) if c.vet_id else None
    bansuk = is_bansuk(user)
    show_result = bansuk or c.status == "shared"
    d = {
        "id": c.id,
        "status": c.status,
        "awaiting": c.awaiting,
        "farm": {"id": farm.id, "name": farm.name, "region": farm.region} if farm else None,
        "house": {"id": house.id, "name": house.name} if house else None,
        "flock": {"id": flock.id, "placed_on": flock.placed_on.isoformat(), "age_days": age_days(flock, _local_date(c.reported_at))}
        if flock and c.reported_at
        else None,
        "reported_at": _utc(c.reported_at),
        "dead_count": c.dead_count,
        "onset": c.onset,
        "symptoms": c.symptoms or [],
        "report_note": c.report_note,
        "proposals": c.proposals or [],
        "scheduled_at": _iso(c.scheduled_at),
        "vet": {"id": vet.id, "name": vet.name} if vet else None,
        "shared_at": _utc(c.shared_at),
        "updated_at": _utc(c.updated_at),
    }
    if show_result:
        d["result"] = {
            "performed_at": _iso(c.performed_at),
            "birds_examined": c.birds_examined,
            "findings": c.findings or [],
            "suspected": c.suspected or [],
            "samples": c.samples or [],
            "summary": c.summary,
            "advice": c.advice,
            "final_diagnosis": c.final_diagnosis,
        }
        if bansuk:
            d["result"]["internal_note"] = c.internal_note
    if not detail:
        return d
    names = {u.id: (u.name, u.role in BANSUK_ROLES) for u in db.query(User.id, User.name, User.role)}
    events = db.query(CaseEvent).filter(CaseEvent.case_id == c.id).order_by(CaseEvent.id).all()
    d["events"] = [
        {
            "id": e.id,
            "at": _utc(e.at),
            "kind": e.kind,
            "data": e.data or {},
            "author": names.get(e.author_id, ("", False))[0] if e.author_id else "",
            "side": ("bansuk" if names.get(e.author_id, ("", False))[1] else "farm") if e.author_id else "system",
            "mine": e.author_id == user.id,
        }
        for e in events
    ]
    photos = db.query(CasePhoto).filter(CasePhoto.case_id == c.id).order_by(CasePhoto.id).all()
    d["photos"] = [
        {
            "id": p.id,
            "stage": p.stage,
            "thumb": signed_url(p.id, "thumb"),
            "full": signed_url(p.id, "full"),
            "width": p.width,
            "height": p.height,
            "taken_at": _iso(p.taken_at),
            "caption": p.caption,
            "can_delete": bansuk or p.uploaded_by == user.id,
        }
        for p in photos
        if p.stage == "report" or show_result
    ]
    d["production"] = _production(db, c)
    if bansuk:
        d["vets"] = [
            {"id": u.id, "name": u.name}
            for u in db.query(User).filter(User.role.in_(BANSUK_ROLES), User.active.is_(True)).order_by(User.name)
        ]
    return d


# ---------- 목록·신고 ----------

@router.get("/cases")
def list_cases(
    status: str | None = None,
    farm_id: int | None = None,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    q = db.query(NecropsyCase)
    ids = accessible_farm_ids(db, user)
    if ids is not None:
        q = q.filter(NecropsyCase.farm_id.in_(ids))
    if farm_id:
        require_farm(db, user, farm_id)
        q = q.filter(NecropsyCase.farm_id == farm_id)
    if status == "open":
        q = q.filter(NecropsyCase.status.in_(OPEN + ("done",)))
    elif status:
        q = q.filter(NecropsyCase.status == status)
    cases = q.order_by(NecropsyCase.reported_at.desc()).limit(200).all()
    return {"cases": [_case_dict(db, c, user) for c in cases]}


class ReportIn(BaseModel):
    farm_id: int
    house_id: int | None = None
    dead_count: int | None = Field(default=None, ge=0, le=1_000_000)
    onset: Literal["today", "yesterday", "days_2_3", "week"] | None = None
    symptoms: list[str] = Field(default_factory=list, max_length=20)
    note: str | None = Field(default=None, max_length=2000)


@router.post("/cases")
def report_case(body: ReportIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require_farm(db, user, body.farm_id)
    flock_id = None
    if body.house_id is not None:
        house = db.get(House, body.house_id)
        if not house or house.farm_id != body.farm_id:
            raise HTTPException(400, "이 농장의 계사가 아닙니다")
        loc = flock_location_at(db, body.house_id, dt.date.today())
        flock_id = loc.flock_id if loc else None
    c = NecropsyCase(
        farm_id=body.farm_id,
        house_id=body.house_id,
        flock_id=flock_id,
        status="reported",
        awaiting="bansuk",
        reported_by=user.id,
        reported_at=now(),
        dead_count=body.dead_count,
        onset=body.onset,
        symptoms=[s[:40] for s in body.symptoms],
        report_note=body.note,
        proposals=[],
    )
    db.add(c)
    db.flush()
    _event(db, c, "reported", user, dead=body.dead_count, onset=body.onset, symptoms=c.symptoms, note=body.note)
    _notify(db, c, "case_reported", _bansuk_targets(db, c, everyone=True), user)
    db.commit()
    return _case_dict(db, c, user, detail=True)


@router.get("/cases/{case_id}")
def get_case(case_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = _get_case(db, user, case_id)
    # 이 건의 알림은 읽은 것으로
    db.query(Notification).filter(Notification.user_id == user.id, Notification.case_id == c.id, Notification.read_at.is_(None)).update(
        {Notification.read_at: now()}, synchronize_session=False
    )
    db.commit()
    return _case_dict(db, c, user, detail=True)


# ---------- 일정 ----------

class ProposeIn(BaseModel):
    slots: list[str] = Field(min_length=1, max_length=3)
    vet_id: int | None = None
    message: str | None = Field(default=None, max_length=1000)


@router.post("/cases/{case_id}/propose")
def propose(case_id: int, body: ProposeIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """반석: 부검 가능한 시간을 1~3개 제안. 농장이 하나를 고르면 확정."""
    _need_bansuk(user)
    c = _get_case(db, user, case_id)
    if c.status not in OPEN:
        raise HTTPException(400, "지금은 일정을 바꿀 수 없는 상태입니다")
    slots = sorted({_parse_at(s) for s in body.slots})
    if body.vet_id:
        vet = db.get(User, body.vet_id)
        if not vet or vet.role not in BANSUK_ROLES:
            raise HTTPException(400, "담당 수의사를 확인해 주세요")
        c.vet_id = vet.id
    elif not c.vet_id:
        c.vet_id = user.id
    c.proposals = [{"at": _iso(s), "by": "bansuk"} for s in slots]
    c.status, c.awaiting, c.scheduled_at = "scheduling", "farm", None
    _event(db, c, "proposed", user, slots=[_iso(s) for s in slots], message=body.message)
    _notify(db, c, "case_proposed", _farm_targets(db, c), user, slots=[_iso(s) for s in slots])
    db.commit()
    return _case_dict(db, c, user, detail=True)


class AtIn(BaseModel):
    at: str
    message: str | None = Field(default=None, max_length=1000)


@router.post("/cases/{case_id}/accept")
def accept(case_id: int, body: AtIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """농장: 반석이 제안한 시간 중 하나를 수락 → 확정."""
    c = _get_case(db, user, case_id)
    if is_bansuk(user):
        raise HTTPException(403, "반석은 '일정 확정'을 쓰세요")
    at = _parse_at(body.at)
    if c.status != "scheduling" or _iso(at) not in [p["at"] for p in c.proposals or [] if p.get("by") == "bansuk"]:
        raise HTTPException(400, "제안된 시간 중에서 골라 주세요")
    c.scheduled_at, c.status, c.awaiting = at, "scheduled", None
    _event(db, c, "accepted", user, at=_iso(at), message=body.message)
    _notify(db, c, "case_accepted", _bansuk_targets(db, c), user, at=_iso(at))
    db.commit()
    return _case_dict(db, c, user, detail=True)


class RequestIn(BaseModel):
    at: str | None = None
    message: str | None = Field(default=None, max_length=1000)


@router.post("/cases/{case_id}/request")
def request_other(case_id: int, body: RequestIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """농장: 제안된 시간이 안 되면 원하는 시간을 요청 (확정된 일정 변경 요청도 이것으로)."""
    c = _get_case(db, user, case_id)
    if is_bansuk(user):
        raise HTTPException(403, "반석은 '시간 제안'을 쓰세요")
    if c.status not in OPEN:
        raise HTTPException(400, "지금은 일정을 바꿀 수 없는 상태입니다")
    if not body.at and not (body.message or "").strip():
        raise HTTPException(400, "원하는 시간이나 메시지를 적어 주세요")
    at = _parse_at(body.at) if body.at else None
    c.proposals = [p for p in (c.proposals or []) if p.get("by") == "bansuk"] + ([{"at": _iso(at), "by": "farm"}] if at else [])
    c.status, c.awaiting, c.scheduled_at = "scheduling", "bansuk", None
    _event(db, c, "requested", user, at=_iso(at), message=body.message)
    _notify(db, c, "case_requested", _bansuk_targets(db, c), user, at=_iso(at))
    db.commit()
    return _case_dict(db, c, user, detail=True)


class ConfirmIn(BaseModel):
    at: str
    vet_id: int | None = None
    message: str | None = Field(default=None, max_length=1000)


@router.post("/cases/{case_id}/confirm")
def confirm(case_id: int, body: ConfirmIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """반석: 일정을 바로 확정 (농장이 요청한 시간, 또는 전화로 정한 시간)."""
    _need_bansuk(user)
    c = _get_case(db, user, case_id)
    if c.status not in OPEN:
        raise HTTPException(400, "지금은 일정을 바꿀 수 없는 상태입니다")
    at = _parse_at(body.at)
    if body.vet_id:
        vet = db.get(User, body.vet_id)
        if not vet or vet.role not in BANSUK_ROLES:
            raise HTTPException(400, "담당 수의사를 확인해 주세요")
        c.vet_id = vet.id
    elif not c.vet_id:
        c.vet_id = user.id
    c.scheduled_at, c.status, c.awaiting = at, "scheduled", None
    _event(db, c, "confirmed", user, at=_iso(at), message=body.message)
    _notify(db, c, "case_confirmed", _farm_targets(db, c), user, at=_iso(at))
    db.commit()
    return _case_dict(db, c, user, detail=True)


class MessageIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


@router.post("/cases/{case_id}/message")
def message(case_id: int, body: MessageIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = _get_case(db, user, case_id)
    text = body.text.strip()
    if not text:
        raise HTTPException(400, "메시지를 적어 주세요")
    _event(db, c, "message", user, text=text)
    to = _farm_targets(db, c) if is_bansuk(user) else _bansuk_targets(db, c)
    _notify(db, c, "case_message", to, user, text=text[:80])
    db.commit()
    return _case_dict(db, c, user, detail=True)


class CancelIn(BaseModel):
    reason: str | None = Field(default=None, max_length=1000)


@router.post("/cases/{case_id}/cancel")
def cancel(case_id: int, body: CancelIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = _get_case(db, user, case_id)
    if c.status not in OPEN:
        raise HTTPException(400, "부검을 마친 건은 취소할 수 없습니다")
    c.status, c.awaiting = "cancelled", None
    _event(db, c, "cancelled", user, reason=body.reason)
    to = _farm_targets(db, c) if is_bansuk(user) else _bansuk_targets(db, c)
    _notify(db, c, "case_cancelled", to, user, reason=(body.reason or "")[:80])
    db.commit()
    return _case_dict(db, c, user, detail=True)


# ---------- 결과 ----------

class FindingIn(BaseModel):
    organ: str = Field(max_length=40)
    lesions: list[str] = Field(default_factory=list, max_length=20)
    note: str | None = Field(default=None, max_length=500)


class ResultIn(BaseModel):
    performed_at: str | None = None
    birds_examined: int | None = Field(default=None, ge=0, le=10000)
    findings: list[FindingIn] = Field(default_factory=list, max_length=30)
    suspected: list[str] = Field(default_factory=list, max_length=20)
    samples: list[str] = Field(default_factory=list, max_length=20)
    summary: str | None = Field(default=None, max_length=5000)
    advice: str | None = Field(default=None, max_length=5000)
    internal_note: str | None = Field(default=None, max_length=5000)
    final_diagnosis: str | None = Field(default=None, max_length=1000)


@router.put("/cases/{case_id}/result")
def save_result(case_id: int, body: ResultIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """반석: 부검 결과 저장 (여러 번 고칠 수 있음). 공유 전까지 농장에는 보이지 않는다."""
    _need_bansuk(user)
    c = _get_case(db, user, case_id)
    if c.status == "cancelled":
        raise HTTPException(400, "취소된 건입니다")
    first = c.status in OPEN
    c.performed_at = _parse_at(body.performed_at) if body.performed_at else (c.performed_at or c.scheduled_at or _local_now())
    c.birds_examined = body.birds_examined
    c.findings = [f.model_dump() for f in body.findings]
    c.suspected = [s[:80] for s in body.suspected]
    c.samples = [s[:40] for s in body.samples]
    c.summary, c.advice, c.internal_note, c.final_diagnosis = body.summary, body.advice, body.internal_note, body.final_diagnosis
    if not c.vet_id:
        c.vet_id = user.id
    if first:
        c.status, c.awaiting = "done", None
        _event(db, c, "done", user)
    elif c.status == "shared":
        _event(db, c, "result_updated", user)
        _notify(db, c, "case_result_updated", _farm_targets(db, c), user)
    db.commit()
    return _case_dict(db, c, user, detail=True)


@router.post("/cases/{case_id}/share")
def share(case_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    _need_bansuk(user)
    c = _get_case(db, user, case_id)
    if c.status != "done":
        raise HTTPException(400, "결과를 먼저 저장해 주세요")
    if not (c.summary or "").strip() and not c.findings:
        raise HTTPException(400, "소견 요약이나 장기별 소견을 적어 주세요")
    c.status, c.shared_at = "shared", now()
    _event(db, c, "shared", user)
    _notify(db, c, "case_shared", _farm_targets(db, c), user)
    db.commit()
    return _case_dict(db, c, user, detail=True)


# ---------- 사진 ----------

@router.post("/cases/{case_id}/photos")
async def upload_photos(
    case_id: int,
    files: list[UploadFile] = File(...),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    c = _get_case(db, user, case_id)
    if c.status == "cancelled":
        raise HTTPException(400, "취소된 건입니다")
    if len(files) > MAX_PHOTOS_PER_CALL:
        raise HTTPException(400, "한 번에 30장까지 올릴 수 있습니다")
    stage = "necropsy" if is_bansuk(user) else "report"
    saved, failed = 0, []
    for f in files:
        try:
            info = save_photo(c.id, await f.read())
        except ValueError as e:
            failed.append({"name": f.filename, "error": str(e)})
            continue
        db.add(CasePhoto(case_id=c.id, stage=stage, uploaded_by=user.id, **info))
        saved += 1
    if saved:
        _event(db, c, "photos", user, count=saved, stage=stage)
        if stage == "report":
            _notify(db, c, "case_photos", _bansuk_targets(db, c), user, count=saved)
    db.commit()
    return {**_case_dict(db, c, user, detail=True), "upload": {"saved": saved, "failed": failed}}


@router.delete("/cases/{case_id}/photos/{photo_id}")
def delete_photo(case_id: int, photo_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = _get_case(db, user, case_id)
    p = db.get(CasePhoto, photo_id)
    if not p or p.case_id != c.id:
        raise HTTPException(404, "사진을 찾을 수 없습니다")
    if not is_bansuk(user) and p.uploaded_by != user.id:
        raise HTTPException(403, "올린 사람만 지울 수 있습니다")
    storage.delete(p.key)
    storage.delete(p.thumb_key)
    db.delete(p)
    db.commit()
    return _case_dict(db, c, user, detail=True)


@router.get("/photos/{photo_id}/{size}")
def photo_file(photo_id: int, size: Literal["full", "thumb"], exp: int = Query(...), sig: str = Query(...), db: Session = Depends(get_db)):
    if not check_sig(photo_id, size, exp, sig):
        raise HTTPException(403, "사진 링크가 만료되었습니다. 화면을 새로 고쳐 주세요")
    p = db.get(CasePhoto, photo_id)
    if not p:
        raise HTTPException(404, "사진을 찾을 수 없습니다")
    data = storage.get(p.thumb_key if size == "thumb" else p.key)
    return Response(data, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600"})


# ---------- 알림 ----------

@router.get("/notifications")
def notifications(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.query(Notification).filter(Notification.user_id == user.id).order_by(Notification.id.desc()).limit(50).all()
    unread = db.query(Notification).filter(Notification.user_id == user.id, Notification.read_at.is_(None)).count()
    return {
        "unread": unread,
        "items": [
            {"id": n.id, "case_id": n.case_id, "kind": n.kind, "data": n.data or {}, "at": _utc(n.created_at), "read": n.read_at is not None}
            for n in rows
        ],
    }


@router.get("/notifications/count")
def notification_count(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return {"unread": db.query(Notification).filter(Notification.user_id == user.id, Notification.read_at.is_(None)).count()}


@router.post("/notifications/read-all")
def read_all(user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.query(Notification).filter(Notification.user_id == user.id, Notification.read_at.is_(None)).update(
        {Notification.read_at: now()}, synchronize_session=False
    )
    db.commit()
    return {"unread": 0}
