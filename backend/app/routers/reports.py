"""분석·보고서 API.

GET  /api/farms/{farm_id}/flocks                       계군 목록 (보고서 대상 선택)
GET  /api/farms/{farm_id}/dashboard?date=              농장주 운영 대시보드
GET  /api/reports/flocks/{flock_id}                    계군 성적 보고서 미리보기 (저장 안 함)
POST /api/reports/flocks/{flock_id}/issue              정식 발행: 번호를 매기고 결과를 고정 저장 (반석만)
GET  /api/reports/issued/{report_no}                   발행본 조회
GET  /api/reports/flocks/{flock_id}/data.csv           보고서에 쓴 원자료
"""
import csv
import datetime as dt
import io

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import DailyRecord, Farm, Flock, FlockLocation, House, IssuedReport, User
from ..security import BANSUK_ROLES, current_user, require_farm
from ..services.analysis import flock_csv_rows, flock_report, house_trends

router = APIRouter(prefix="/api", tags=["reports"])


def _flock_checked(db: Session, user: User, flock_id: int) -> Flock:
    flock = db.get(Flock, flock_id)
    if not flock:
        raise HTTPException(404, "계군을 찾을 수 없습니다")
    require_farm(db, user, flock.farm_id)
    return flock


@router.get("/farms/{farm_id}/flocks")
def list_flocks(farm_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require_farm(db, user, farm_id)
    counts = dict(
        db.query(DailyRecord.flock_id, func.count(DailyRecord.id))
        .filter(DailyRecord.farm_id == farm_id)
        .group_by(DailyRecord.flock_id)
    )
    out = []
    for f in db.query(Flock).filter(Flock.farm_id == farm_id).order_by(Flock.placed_on.desc()):
        houses = [
            db.get(House, loc.house_id).name
            for loc in db.query(FlockLocation).filter(FlockLocation.flock_id == f.id).order_by(FlockLocation.from_date)
        ]
        out.append(
            {
                "id": f.id,
                "name": f.name,
                "placed_on": f.placed_on.isoformat(),
                "status": f.status,
                "program": f.program_name,
                "houses": houses,
                "records": counts.get(f.id, 0),
            }
        )
    return {"flocks": out}


@router.get("/farms/{farm_id}/dashboard")
def dashboard(
    farm_id: int,
    date: dt.date | None = Query(default=None),
    days: int = Query(default=28, ge=7, le=120),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    require_farm(db, user, farm_id)
    farm = db.get(Farm, farm_id)
    end = date or dt.date.today()
    return {"farm": {"id": farm.id, "name": farm.name}, "date": end.isoformat(), "houses": house_trends(db, farm_id, end, days)}


def _build(db: Session, flock: Flock, age_from, age_to, baseline) -> dict:
    try:
        rep = flock_report(db, flock.id, age_from, age_to, baseline)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    farm = db.get(Farm, flock.farm_id)
    rep["farm"] = {"id": farm.id, "name": farm.name, "region": farm.region}
    return rep


@router.get("/reports/flocks/{flock_id}")
def preview(
    flock_id: int,
    age_from: int | None = Query(default=None, ge=1),
    age_to: int | None = Query(default=None, ge=1),
    baseline: str = Query(default="past", pattern="^(past|all)$"),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    flock = _flock_checked(db, user, flock_id)
    rep = _build(db, flock, age_from, age_to, baseline)
    rep["meta"] = {"status": "preview", "generated_at": dt.datetime.now().isoformat(timespec="seconds")}
    return rep


class IssueIn(BaseModel):
    age_from: int | None = Field(default=None, ge=1)
    age_to: int | None = Field(default=None, ge=1)
    baseline: str = Field(default="past", pattern="^(past|all)$")
    reviewer_note: str | None = Field(default=None, max_length=2000)


@router.post("/reports/flocks/{flock_id}/issue")
def issue(flock_id: int, body: IssueIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if user.role not in BANSUK_ROLES:
        raise HTTPException(403, "정식 보고서는 반석에서 발행합니다")
    flock = _flock_checked(db, user, flock_id)
    rep = _build(db, flock, body.age_from, body.age_to, body.baseline)
    today = dt.date.today()
    seq = db.query(IssuedReport).filter(IssuedReport.report_no.like(f"BS{today:%y}-RPT-%")).count() + 1
    report_no = f"BS{today:%y}-RPT-{seq:04d}"
    rep["meta"] = {
        "status": "issued",
        "report_no": report_no,
        "issued_at": dt.datetime.now().isoformat(timespec="seconds"),
        "issued_by": user.name,
        "reviewer_note": body.reviewer_note,
    }
    db.add(
        IssuedReport(
            report_no=report_no,
            farm_id=flock.farm_id,
            flock_id=flock.id,
            params=body.model_dump(),
            payload=rep,
            fingerprint=rep["data"]["fingerprint"],
            reviewer_note=body.reviewer_note,
            issued_by=user.id,
        )
    )
    db.commit()
    return rep


@router.get("/reports/issued/{report_no}")
def get_issued(report_no: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    r = db.query(IssuedReport).filter_by(report_no=report_no).one_or_none()
    if not r:
        raise HTTPException(404, "발행된 보고서를 찾을 수 없습니다")
    require_farm(db, user, r.farm_id)
    payload = dict(r.payload)
    # 발행 후 원자료가 바뀌었는지 알려준다 (보고서 내용 자체는 발행 당시 그대로)
    if r.flock_id:
        now = flock_report(db, r.flock_id, r.params.get("age_from"), r.params.get("age_to"), r.params.get("baseline", "past"))
        payload["meta"] = {**payload.get("meta", {}), "data_changed_since_issue": now["data"]["fingerprint"] != r.fingerprint}
    return payload


@router.get("/reports/flocks/{flock_id}/data.csv")
def data_csv(flock_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    flock = _flock_checked(db, user, flock_id)
    buf = io.StringIO()
    buf.write("﻿")  # 엑셀에서 한글이 깨지지 않게
    csv.writer(buf).writerows(flock_csv_rows(db, flock.id))
    buf.seek(0)
    name = f"flock_{flock.id}_{flock.placed_on:%Y%m%d}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )
