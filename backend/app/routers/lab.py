"""질병 검사 결과 (반석 검사 성적서).

반석: 의뢰·결과 입력 (정성 검사의 시료별 양성/음성, 혈청 항체가 역가군 분포), 발행하면 농장에 알림.
농장: 발행된 자기 농장 결과만 본다.
부검 건에서 의뢰한 검사는 case_id로 이어지고, 최종 진단은 부검 건의 final_diagnosis에 적는다.
"""
from __future__ import annotations

import datetime as dt
import os
import tempfile
from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..audit import audit
from ..db import get_db
from ..lab_catalog import ANTIGENS, MAX_GROUP, mean_of
from ..lab_importers import LABELS as FORMAT_LABELS
from ..lab_importers import get_parser
from ..lab_importers.standard import template_bytes
from ..models import (
    Farm,
    Flock,
    House,
    LabSample,
    LabSubmission,
    NecropsyCase,
    Notification,
    SeroResult,
    User,
    UserFarm,
)
from ..security import BANSUK_ROLES, accessible_farm_ids, current_user, require_farm
from ..services.flocks import age_days, flock_location_at

router = APIRouter(prefix="/api/lab", tags=["lab"])

KINDS = ("pcr", "serology", "culture", "other")
RESULT_VALUES = ("positive", "negative", "suspect", "na")
MAX_IMPORT_BYTES = 20 * 1024 * 1024


def _is_bansuk(u: User) -> bool:
    return u.role in BANSUK_ROLES


def _need_bansuk(u: User) -> None:
    if not _is_bansuk(u):
        raise HTTPException(403, "반석 계정만 할 수 있습니다")


def _get(db: Session, user: User, sid: int) -> LabSubmission:
    s = db.get(LabSubmission, sid)
    if not s:
        raise HTTPException(404, "검사 결과를 찾을 수 없습니다")
    require_farm(db, user, s.farm_id)
    if not _is_bansuk(user) and s.status != "issued":
        raise HTTPException(404, "검사 결과를 찾을 수 없습니다")
    return s


def _d(v: dt.date | None) -> str | None:
    return v.isoformat() if v else None


def _positive(db: Session, s: LabSubmission) -> bool:
    return (
        db.query(LabSample)
        .filter(LabSample.submission_id == s.id, LabSample.control.is_(False), LabSample.result == "positive")
        .count()
        > 0
    )


def _brief(db: Session, s: LabSubmission, farms: dict[int, str], houses: dict[int, str]) -> dict:
    out = {
        "id": s.id,
        "report_no": s.report_no,
        "kind": s.kind,
        "status": s.status,
        "farm_id": s.farm_id,
        "farm": farms.get(s.farm_id, ""),
        "house_id": s.house_id,
        "house": houses.get(s.house_id, "") if s.house_id else "",
        "flock_id": s.flock_id,
        "case_id": s.case_id,
        "sampled_on": _d(s.sampled_on),
        "issued_on": _d(s.issued_on),
        "age_days": s.age_days,
        "method": s.method,
        "target": s.target,
        "disease": s.disease,
    }
    if s.kind == "serology":
        rows = db.query(SeroResult.antigen).filter(SeroResult.submission_id == s.id).distinct().all()
        out["antigens"] = sorted({r[0] for r in rows}, key=lambda a: list(ANTIGENS).index(a) if a in ANTIGENS else 99)
        out["positive"] = None
    else:
        out["antigens"] = []
        out["positive"] = _positive(db, s)
    return out


def _names(db: Session, subs: list[LabSubmission]) -> tuple[dict[int, str], dict[int, str]]:
    fids = {s.farm_id for s in subs}
    hids = {s.house_id for s in subs if s.house_id}
    farms = {f.id: f.name for f in db.query(Farm).filter(Farm.id.in_(fids))} if fids else {}
    houses = {h.id: h.name for h in db.query(House).filter(House.id.in_(hids))} if hids else {}
    return farms, houses


def _detail(db: Session, user: User, s: LabSubmission) -> dict:
    farms, houses = _names(db, [s])
    out = _brief(db, s, farms, houses)
    out.update(
        requester=s.requester,
        requested_on=_d(s.requested_on),
        opinion=s.opinion,
        source=s.source,
        can_edit=_is_bansuk(user),
        samples=[
            {"id": x.id, "sample": x.sample, "result": x.result, "value": x.value, "control": x.control}
            for x in db.query(LabSample).filter(LabSample.submission_id == s.id).order_by(LabSample.sort_order, LabSample.id)
        ],
        sero=[
            {"id": x.id, "antigen": x.antigen, "group_label": x.group_label, "counts": x.counts or [], "n": x.n, "mean": x.mean}
            for x in db.query(SeroResult).filter(SeroResult.submission_id == s.id).order_by(SeroResult.sort_order, SeroResult.id)
        ],
    )
    case = db.get(NecropsyCase, s.case_id) if s.case_id else None
    out["case"] = (
        {"id": case.id, "status": case.status, "final_diagnosis": case.final_diagnosis, "suspected": case.suspected or []}
        if case
        else None
    )
    return out


# ---------- 목록·카탈로그 ----------

@router.get("/catalog")
def catalog(_: User = Depends(current_user)):
    return {
        "antigens": [{"code": c, "label": label, "disease": dis} for c, (label, dis) in ANTIGENS.items()],
        "max_group": MAX_GROUP,
        "formats": [{"code": c, "label": label} for c, label in FORMAT_LABELS.items()],
    }


@router.get("")
def list_lab(
    farm_id: int | None = None,
    case_id: int | None = None,
    flock_id: int | None = None,
    kind: str | None = None,
    status: str | None = None,
    limit: int = Query(200, le=500),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    q = db.query(LabSubmission)
    ids = accessible_farm_ids(db, user)
    if ids is not None:
        q = q.filter(LabSubmission.farm_id.in_(ids or [-1]), LabSubmission.status == "issued")
    elif status:
        q = q.filter(LabSubmission.status == status)
    if farm_id:
        require_farm(db, user, farm_id)
        q = q.filter(LabSubmission.farm_id == farm_id)
    if case_id:
        q = q.filter(LabSubmission.case_id == case_id)
    if flock_id:
        q = q.filter(LabSubmission.flock_id == flock_id)
    if kind:
        q = q.filter(LabSubmission.kind == kind)
    subs = q.order_by(LabSubmission.sampled_on.desc().nullslast(), LabSubmission.id.desc()).limit(limit).all()
    farms, houses = _names(db, subs)
    return {"items": [_brief(db, s, farms, houses) for s in subs], "can_edit": _is_bansuk(user)}


@router.get("/titers")
def titers(
    farm_id: int,
    house_id: int | None = None,
    flock_id: int | None = None,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """항체가 추이: 항원별 (채혈일, 일령, 구분, 평균, 시료수) 목록."""
    require_farm(db, user, farm_id)
    q = db.query(LabSubmission).filter(LabSubmission.farm_id == farm_id, LabSubmission.kind == "serology")
    if not _is_bansuk(user):
        q = q.filter(LabSubmission.status == "issued")
    if flock_id:
        q = q.filter(LabSubmission.flock_id == flock_id)
    elif house_id:
        q = q.filter(LabSubmission.house_id == house_id)
    subs = {s.id: s for s in q}
    series: dict[str, list[dict]] = {}
    if subs:
        for r in db.query(SeroResult).filter(SeroResult.submission_id.in_(subs)).order_by(SeroResult.sort_order, SeroResult.id):
            s = subs[r.submission_id]
            series.setdefault(r.antigen, []).append(
                {"submission_id": s.id, "sampled_on": _d(s.sampled_on), "age_days": s.age_days,
                 "group_label": r.group_label, "mean": r.mean, "n": r.n, "counts": r.counts or []}
            )
    for pts in series.values():
        pts.sort(key=lambda p: (p["sampled_on"] or "", p["group_label"] or ""))
    order = list(ANTIGENS)
    return {"series": [{"antigen": a, "points": series[a]} for a in sorted(series, key=lambda a: order.index(a) if a in order else 99)]}


# ---------- 입력·수정 ----------

class SampleIn(BaseModel):
    sample: str = Field(min_length=1, max_length=120)
    result: Literal["positive", "negative", "suspect", "na"] = "na"
    value: str | None = Field(default=None, max_length=40)
    control: bool = False


class SeroIn(BaseModel):
    antigen: str
    group_label: str | None = Field(default=None, max_length=40)
    counts: list[int] = Field(default_factory=list, max_length=MAX_GROUP + 1)


class LabIn(BaseModel):
    kind: Literal["pcr", "serology", "culture", "other"] = "pcr"
    farm_id: int
    house_id: int | None = None
    case_id: int | None = None
    report_no: str | None = Field(default=None, max_length=40)
    requester: str | None = Field(default=None, max_length=60)
    requested_on: dt.date | None = None
    sampled_on: dt.date | None = None
    age_days: int | None = Field(default=None, ge=0, le=2000)
    method: str | None = Field(default=None, max_length=60)
    target: str | None = Field(default=None, max_length=120)
    disease: str | None = Field(default=None, max_length=40)
    opinion: str | None = Field(default=None, max_length=2000)
    samples: list[SampleIn] = Field(default_factory=list, max_length=60)
    sero: list[SeroIn] = Field(default_factory=list, max_length=80)


def _apply(db: Session, s: LabSubmission, body: LabIn) -> None:
    farm = db.get(Farm, body.farm_id)
    if not farm:
        raise HTTPException(404, "농장을 찾을 수 없습니다")
    house = db.get(House, body.house_id) if body.house_id else None
    if body.house_id and (not house or house.farm_id != farm.id):
        raise HTTPException(400, "이 농장의 계사가 아닙니다")
    if body.case_id:
        c = db.get(NecropsyCase, body.case_id)
        if not c or c.farm_id != farm.id:
            raise HTTPException(400, "이 농장의 부검 건이 아닙니다")
    for x in body.sero:
        if x.antigen not in ANTIGENS:
            raise HTTPException(400, "모르는 항원입니다")
        if any(v < 0 or v > 100000 for v in x.counts):
            raise HTTPException(400, "역가군 마리 수가 올바르지 않습니다")
    for k in ("kind", "farm_id", "house_id", "case_id", "report_no", "requester", "requested_on", "sampled_on",
              "method", "target", "disease", "opinion"):
        v = getattr(body, k)
        setattr(s, k, (v.strip() or None) if isinstance(v, str) else v)
    # 계군·일령: 계사와 채취일로 찾는다 (직접 적은 일령이 우선)
    s.flock_id = None
    s.age_days = body.age_days
    if house and s.sampled_on:
        loc = flock_location_at(db, house.id, s.sampled_on)
        if loc:
            s.flock_id = loc.flock_id
            if s.age_days is None:
                fl = db.get(Flock, loc.flock_id)
                s.age_days = age_days(fl, s.sampled_on)
    db.flush()
    db.query(LabSample).filter(LabSample.submission_id == s.id).delete()
    db.query(SeroResult).filter(SeroResult.submission_id == s.id).delete()
    if s.kind != "serology":
        for i, x in enumerate(body.samples):
            db.add(LabSample(submission_id=s.id, sample=x.sample.strip(), result=x.result, value=(x.value or "").strip() or None,
                             control=x.control, sort_order=i))
    else:
        for i, x in enumerate(body.sero):
            counts = list(x.counts)
            while counts and counts[-1] == 0:
                counts.pop()
            db.add(SeroResult(submission_id=s.id, antigen=x.antigen, group_label=(x.group_label or "").strip() or None,
                              counts=counts, n=sum(counts), mean=mean_of(counts), sort_order=i))


@router.post("")
def create(body: LabIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    _need_bansuk(user)
    s = LabSubmission(created_by=user.id, source="manual")
    db.add(s)
    _apply(db, s, body)
    audit(db, user.id, "lab_created", target_farm_id=s.farm_id, detail={"lab_id": s.id, "kind": s.kind})
    db.commit()
    return _detail(db, user, s)


@router.get("/template.xlsx")
def template(user: User = Depends(current_user)):
    _need_bansuk(user)
    return Response(
        template_bytes(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=lab-template.xlsx"},
    )


@router.get("/{sid}")
def get_one(sid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _detail(db, user, _get(db, user, sid))


@router.put("/{sid}")
def update(sid: int, body: LabIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    _need_bansuk(user)
    s = _get(db, user, sid)
    _apply(db, s, body)
    audit(db, user.id, "lab_updated", target_farm_id=s.farm_id, detail={"lab_id": s.id})
    if s.status == "issued":
        _notify(db, s, "lab_updated", user)
    db.commit()
    return _detail(db, user, s)


def _notify(db: Session, s: LabSubmission, kind: str, actor: User) -> None:
    farm = db.get(Farm, s.farm_id)
    house = db.get(House, s.house_id) if s.house_id else None
    owners = (
        db.query(User.id)
        .join(UserFarm, UserFarm.user_id == User.id)
        .filter(UserFarm.farm_id == s.farm_id, User.active.is_(True), User.role == "farm_owner")
        .all()
    )
    data = {"farm": farm.name if farm else "", "house": house.name if house else "", "lab_id": s.id,
            "lab_kind": s.kind, "target": s.target or "", "by": actor.name}
    for (uid,) in owners:
        db.add(Notification(user_id=uid, case_id=s.case_id, kind=kind, data=data))


@router.post("/{sid}/issue")
def issue(sid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    _need_bansuk(user)
    s = _get(db, user, sid)
    if s.status == "issued":
        raise HTTPException(409, "이미 발행한 결과입니다")
    has_rows = db.query(LabSample).filter(LabSample.submission_id == s.id).count() + db.query(SeroResult).filter(
        SeroResult.submission_id == s.id
    ).count()
    if not has_rows:
        raise HTTPException(400, "결과를 한 줄 이상 입력해 주세요")
    s.status = "issued"
    s.issued_on = s.issued_on or dt.date.today()
    _notify(db, s, "lab_issued", user)
    audit(db, user.id, "lab_issued", target_farm_id=s.farm_id, detail={"lab_id": s.id})
    db.commit()
    return _detail(db, user, s)


@router.post("/{sid}/unissue")
def unissue(sid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    _need_bansuk(user)
    s = _get(db, user, sid)
    s.status = "draft"
    audit(db, user.id, "lab_unissued", target_farm_id=s.farm_id, detail={"lab_id": s.id})
    db.commit()
    return _detail(db, user, s)


@router.delete("/{sid}")
def delete(sid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    _need_bansuk(user)
    s = _get(db, user, sid)
    if s.status == "issued":
        raise HTTPException(409, "발행한 결과는 먼저 발행을 취소해야 지울 수 있습니다")
    db.query(LabSample).filter(LabSample.submission_id == s.id).delete()
    db.query(SeroResult).filter(SeroResult.submission_id == s.id).delete()
    audit(db, user.id, "lab_deleted", target_farm_id=s.farm_id, detail={"lab_id": s.id})
    db.delete(s)
    db.commit()
    return {"ok": True}


# ---------- 성적서 파일 올리기 ----------

def _find_farm(db: Session, name: str | None) -> Farm | None:
    if not name:
        return None
    key = name.replace(" ", "")
    for f in db.query(Farm).all():
        if f.name.replace(" ", "") == key:
            return f
    return None


def _find_house(db: Session, farm: Farm, name: str | None) -> House | None:
    if not name:
        return None
    key = name.replace(" ", "")
    for h in db.query(House).filter(House.farm_id == farm.id):
        if h.name.replace(" ", "") == key:
            return h
    return None


@router.post("/import")
async def import_file(
    format: str = Query("standard_xlsx"),
    file: UploadFile = File(...),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """성적서 파일을 읽어 '작성 중' 결과로 만든다. 확인 후 하나씩 발행한다."""
    _need_bansuk(user)
    try:
        parser = get_parser(format)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    data = await file.read()
    if len(data) > MAX_IMPORT_BYTES:
        raise HTTPException(413, "파일이 너무 큽니다")
    suffix = os.path.splitext(file.filename or "")[1].lower() or ".xlsx"
    with tempfile.NamedTemporaryFile(suffix=suffix) as tmp:
        tmp.write(data)
        tmp.flush()
        try:
            parsed = parser.parse(tmp.name)
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
        except Exception as e:  # noqa: BLE001 - 깨진 파일
            raise HTTPException(400, "파일을 읽을 수 없습니다. 양식을 확인해 주세요") from e
    created, skipped = [], []
    for item in parsed:
        farm = _find_farm(db, item.get("farm"))
        if not farm:
            skipped.append({"farm": item.get("farm"), "reason": "unknown_farm"})
            continue
        house = _find_house(db, farm, item.get("house"))
        body = LabIn(
            kind=item.get("kind", "other"), farm_id=farm.id, house_id=house.id if house else None,
            report_no=item.get("report_no"), requester=item.get("requester"), requested_on=item.get("requested_on"),
            sampled_on=item.get("sampled_on"), age_days=item.get("age_days"), method=item.get("method"),
            target=item.get("target"), disease=item.get("disease"), opinion=item.get("opinion"),
            samples=[SampleIn(**x) for x in item.get("samples", [])],
            sero=[SeroIn(**x) for x in item.get("sero", []) if x["antigen"] in ANTIGENS],
        )
        s = LabSubmission(created_by=user.id, source="import")
        db.add(s)
        _apply(db, s, body)
        created.append(s.id)
    audit(db, user.id, "lab_imported", detail={"created": len(created), "skipped": len(skipped), "format": format})
    db.commit()
    return {"created": created, "skipped": skipped}
