"""최근 유행 질병: 반석이 본 부검 건과 검사 결과를 기간·지역·질병별로 모은다.

한 '발생'은 (농장, 질병, 날짜) 하나다. 출처:
- 부검: 부검을 마친 건(done·shared)의 최종 진단 질병, 최종 진단 전이면 의심 질병 (부검일 기준)
- 검사: 발행된 PCR·배양 결과 중 대조가 아닌 시료가 양성인 것 (채취일 기준, 질병 코드가 있는 것)
같은 농장·질병이 부검과 검사에 함께 나오면 7일 안이면 한 번만 센다.
'확인'은 수의사가 최종 진단했거나 검사에서 양성이 나온 발생이다.
혈청 항체가는 백신 영향이 커서 넣지 않는다.

반석은 농장 이름까지 보고, 농장은 농장 이름 없이 지역·질병만 본다.
"""
from __future__ import annotations

import datetime as dt
from collections import defaultdict

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Farm, LabSample, LabSubmission, NecropsyCase, User
from ..security import BANSUK_ROLES, current_user

router = APIRouter(prefix="/api", tags=["epidemic"])

MERGE_DAYS = 7


def collect(db: Session, start: dt.date, end: dt.date, region: str | None = None) -> list[dict]:
    """기간 안의 발생 목록 (날짜 오래된 순). 분석기 데이터 출처로도 쓴다."""
    farms = {f.id: f for f in db.query(Farm)}
    events: list[dict] = []
    t0, t1 = dt.datetime.combine(start, dt.time()), dt.datetime.combine(end + dt.timedelta(days=1), dt.time())
    for c in (
        db.query(NecropsyCase)
        .filter(NecropsyCase.status.in_(("done", "shared")), NecropsyCase.performed_at >= t0, NecropsyCase.performed_at < t1)
    ):
        final = [d for d in (c.final_diseases or []) if d != "undetermined"]
        codes = final if c.final_diseases else (c.suspected or [])  # 최종 진단이 있으면 그것만, 없으면 의심 질병
        for d in codes:
            if isinstance(d, str) and d and d.isascii():
                events.append({"farm_id": c.farm_id, "disease": d, "date": c.performed_at.date(), "source": "necropsy",
                               "case_id": c.id, "lab_id": None, "confirmed": bool(final)})
    pos = {
        sid
        for (sid,) in db.query(LabSample.submission_id)
        .filter(LabSample.control.is_(False), LabSample.result == "positive")
        .distinct()
    }
    for s in (
        db.query(LabSubmission)
        .filter(LabSubmission.status == "issued", LabSubmission.kind.in_(("pcr", "culture", "other")),
                LabSubmission.disease.isnot(None), LabSubmission.sampled_on >= start, LabSubmission.sampled_on <= end)
    ):
        if s.id in pos:
            events.append({"farm_id": s.farm_id, "disease": s.disease, "date": s.sampled_on, "source": "lab",
                           "case_id": s.case_id, "lab_id": s.id, "confirmed": True})
    # 부검 + 검사 같은 발생 합치기
    events.sort(key=lambda e: (e["farm_id"], e["disease"], e["date"], e["source"] != "lab"))
    merged: list[dict] = []
    for e in events:
        prev = merged[-1] if merged else None
        if prev and prev["farm_id"] == e["farm_id"] and prev["disease"] == e["disease"] and (e["date"] - prev["date"]).days <= MERGE_DAYS:
            prev["confirmed"] = prev["confirmed"] or e["confirmed"]
            prev["lab_id"] = prev["lab_id"] or e["lab_id"]
            prev["case_id"] = prev["case_id"] or e["case_id"]
            if e["source"] != prev["source"]:
                prev["source"] = "both"
            continue
        merged.append(dict(e))
    for e in merged:
        f = farms.get(e["farm_id"])
        e["farm"] = f.name if f else ""
        e["region"] = (f.region or "").split()[0] if f and f.region else ""
    if region:
        merged = [e for e in merged if e["region"] == region]
    merged.sort(key=lambda e: e["date"])
    return merged


def _week_start(d: dt.date) -> dt.date:
    return d - dt.timedelta(days=d.weekday())


@router.get("/epidemic")
def epidemic(
    days: int = Query(90, ge=7, le=730),
    region: str | None = None,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    today = dt.date.today()
    start = today - dt.timedelta(days=days - 1)
    events = collect(db, start, today, region or None)
    bansuk = user.role in BANSUK_ROLES

    # 지난 기간과 비교 (같은 길이)
    prev = collect(db, start - dt.timedelta(days=days), start - dt.timedelta(days=1), region or None)
    prev_count: dict[str, int] = defaultdict(int)
    for e in prev:
        prev_count[e["disease"]] += 1

    weeks: list[dt.date] = []
    w = _week_start(start)
    while w <= today:
        weeks.append(w)
        w += dt.timedelta(days=7)
    widx = {wk: i for i, wk in enumerate(weeks)}
    recent_from = today - dt.timedelta(days=13)

    by: dict[str, dict] = {}
    for e in events:
        d = by.setdefault(e["disease"], {"disease": e["disease"], "count": 0, "confirmed": 0, "farms": set(), "regions": defaultdict(int),
                                         "weekly": [0] * len(weeks), "last": None, "recent": 0})
        d["count"] += 1
        d["confirmed"] += 1 if e["confirmed"] else 0
        d["farms"].add(e["farm_id"])
        if e["region"]:
            d["regions"][e["region"]] += 1
        d["weekly"][widx[_week_start(e["date"])]] += 1
        d["last"] = max(d["last"] or e["date"], e["date"])
        if e["date"] >= recent_from:
            d["recent"] += 1
    diseases = []
    for d in sorted(by.values(), key=lambda x: (-x["recent"], -x["count"])):
        diseases.append({
            "disease": d["disease"], "count": d["count"], "confirmed": d["confirmed"], "farms": len(d["farms"]),
            "recent": d["recent"], "previous": prev_count.get(d["disease"], 0),
            "regions": [{"region": r, "count": n} for r, n in sorted(d["regions"].items(), key=lambda x: -x[1])],
            "weekly": d["weekly"], "last": d["last"].isoformat() if d["last"] else None,
        })

    regions: dict[str, dict] = {}
    for e in events:
        if not e["region"]:
            continue
        r = regions.setdefault(e["region"], {"region": e["region"], "count": 0, "diseases": defaultdict(int)})
        r["count"] += 1
        r["diseases"][e["disease"]] += 1
    region_rows = [
        {"region": r["region"], "count": r["count"],
         "top": [{"disease": k, "count": n} for k, n in sorted(r["diseases"].items(), key=lambda x: -x[1])[:3]]}
        for r in sorted(regions.values(), key=lambda x: -x["count"])
    ]

    recent = []
    for e in sorted(events, key=lambda e: e["date"], reverse=True)[:40]:
        row = {"date": e["date"].isoformat(), "disease": e["disease"], "region": e["region"], "source": e["source"],
               "confirmed": e["confirmed"]}
        if bansuk:
            row.update(farm=e["farm"], farm_id=e["farm_id"], case_id=e["case_id"], lab_id=e["lab_id"])
        recent.append(row)

    all_regions = sorted({(f.region or "").split()[0] for f in db.query(Farm) if f.region})
    return {
        "from": start.isoformat(), "to": today.isoformat(), "days": days, "region": region or None,
        "weeks": [wk.isoformat() for wk in weeks],
        "total": len(events), "farms": len({e["farm_id"] for e in events}),
        "confirmed": sum(1 for e in events if e["confirmed"]),
        "diseases": diseases, "regions": region_rows, "recent": recent, "all_regions": all_regions,
        "show_farms": bansuk,
    }
