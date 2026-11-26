"""반석 첫 화면: 모든 농장을 한 번에 본다.

GET /api/bansuk/overview
  - 할 일: 반석이 답해야 할 부검 건, 밀린 접종, 오늘 입력이 안 들어온 농장
  - 농장별: 오늘 입력 동 수, 최근 7일 산란율과 그 전 7일 대비, 7일 폐사, 진행 중 부검, 접종(밀림·7일 안)
농장주 계정은 쓸 수 없다.
"""
from __future__ import annotations

import datetime as dt
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import DailyRecord, Farm, House, NecropsyCase, User
from ..security import BANSUK_ROLES, current_user
from ..services.flocks import flock_location_at
from ..services.metrics import total_eggs
from ..services.vaccines import due_board, local_today

router = APIRouter(prefix="/api/bansuk", tags=["overview"])

OPEN_CASE = ("reported", "scheduling", "scheduled", "done")


def _bansuk(user: User = Depends(current_user)) -> User:
    if user.role not in BANSUK_ROLES:
        raise HTTPException(403, "반석 계정만 볼 수 있습니다")
    return user


def _lay(recs: list[DailyRecord]) -> float | None:
    eggs = birds = 0
    for r in recs:
        e = total_eggs(r)
        if e is None or not r.bird_count:
            continue
        eggs += e
        birds += r.bird_count
    return round(eggs / birds * 100, 1) if birds else None


@router.get("/overview")
def overview(days: int = 90, user: User = Depends(_bansuk), db: Session = Depends(get_db)):
    today = local_today()
    days = min(max(days, 14), 365)
    since = today - dt.timedelta(days=days)
    farms = db.query(Farm).filter(Farm.active.is_(True)).order_by(Farm.name).all()

    recs: dict[int, list[DailyRecord]] = defaultdict(list)
    for r in db.query(DailyRecord).filter(DailyRecord.date > since, DailyRecord.date <= today):
        recs[r.farm_id].append(r)
    last_date = {
        fid: d
        for fid, d in db.query(DailyRecord.farm_id, DailyRecord.date).order_by(DailyRecord.date)  # 마지막 값이 남음
    }

    cases = db.query(NecropsyCase).filter(NecropsyCase.status.in_(OPEN_CASE)).all()
    vacc = due_board(db, None, 7)

    # 농장별 하루 산란율 (계사 합산) — 첫 화면 추이 차트용
    dates = [(since + dt.timedelta(days=i + 1)).isoformat() for i in range(days)]
    series: dict[int, list[float | None]] = {}
    for f in farms:
        by_day: dict[str, list[DailyRecord]] = defaultdict(list)
        for r in recs.get(f.id, []):
            by_day[r.date.isoformat()].append(r)
        vals = [_lay(by_day[d]) if d in by_day else None for d in dates]
        series[f.id] = [v if v is not None and 0 < v <= 100 else None for v in vals]  # 육성기(0%)는 빼서 눈금이 눌리지 않게

    rows = []
    for f in farms:
        houses = [h for h in db.query(House).filter(House.farm_id == f.id, House.active.is_(True))]
        stocked = [h for h in houses if flock_location_at(db, h.id, today)]
        fr = recs.get(f.id, [])
        today_houses = {r.house_id for r in fr if r.date == today}
        wk = [r for r in fr if r.date > today - dt.timedelta(days=7)]
        prev = [r for r in fr if today - dt.timedelta(days=14) < r.date <= today - dt.timedelta(days=7)]
        lay7, lay_prev = _lay(wk), _lay(prev)
        fc = [c for c in cases if c.farm_id == f.id]
        fv = [v for v in vacc if v["farm"]["id"] == f.id]
        rows.append(
            {
                "id": f.id,
                "name": f.name,
                "region": f.region,
                "houses": len(stocked),
                "entered_today": len(today_houses & {h.id for h in stocked}),
                "last_input": last_date[f.id].isoformat() if f.id in last_date else None,
                "lay_rate_7d": lay7,
                "lay_rate_change": round(lay7 - lay_prev, 1) if lay7 is not None and lay_prev is not None else None,
                "mortality_7d": sum(r.mortality or 0 for r in wk),
                "open_cases": len(fc),
                "cases_awaiting_bansuk": sum(1 for c in fc if c.awaiting == "bansuk" or c.status == "reported"),
                "vacc_overdue": sum(1 for v in fv if v["status"] == "overdue"),
                "vacc_week": sum(1 for v in fv if v["status"] != "overdue"),
                "series": series[f.id],
            }
        )

    names = {f.id: f.name for f in farms}
    todo_cases = [
        {
            "id": c.id,
            "farm": names.get(c.farm_id, "?"),
            "status": c.status,
            "dead_count": c.dead_count,
            "reported_at": c.reported_at.isoformat() if c.reported_at else None,
        }
        for c in sorted(cases, key=lambda c: c.reported_at or dt.datetime.min, reverse=True)
        if c.awaiting == "bansuk" or c.status == "reported"
    ]
    return {
        "today": today.isoformat(),
        "dates": dates,
        "farms": rows,
        "todo": {
            "cases": todo_cases[:10],
            "vaccinations": [
                {
                    "farm": v["farm"]["name"],
                    "farm_id": v["farm"]["id"],
                    "flock_id": v["flock_id"],
                    "house": v["house"],
                    "vaccine": (v.get("vaccine") or {}).get("name"),
                    "planned": v["planned"],
                    "status": v["status"],
                }
                for v in vacc
            ][:12],
            "missing_input": [r["name"] for r in rows if r["houses"] and r["entered_today"] < r["houses"]],
        },
    }
