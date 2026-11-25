"""반석 데이터 분석기용 범용 쿼리.

지표 × x축 × 묶음 × 필터를 조합해 시리즈를 만든다. 비율 지표(산란율, 수당 사료 등)는
구간(버킷) 안의 총량으로 계산한다. 하루 비율을 평균내면 수수가 다른 날·동이 같은 무게로 섞여 틀린다.

데이터 원천은 지금은 생산 기록(daily_record)이고, 검사 결과·부검이 들어오면 SOURCES에 추가한다.
"""
from __future__ import annotations

import datetime as dt
from collections import defaultdict

from sqlalchemy.orm import Session

from ..models import DailyRecord, Farm, Flock, House
from ..settings import AGE_DAY_BASE, EGG_GRADES

SOURCES = {"production": "생산 기록"}

# 지표: 코드 → (이름, 단위, 계산 함수(합계 dict) )
def _ratio(num, den, k=1.0):
    return lambda s: (s[num] / s[den] * k) if s.get(den) else None


METRICS: dict[str, dict] = {
    "lay_rate": {"label": "산란율", "unit": "%", "fn": _ratio("eggs_lay", "birds_lay", 100)},
    "total_eggs": {"label": "총 산란수", "unit": "개", "fn": lambda s: s.get("eggs") or None, "sum": True},
    "bird_count": {"label": "수수(평균)", "unit": "수", "fn": _ratio("birds", "n")},
    "mortality": {"label": "폐사수", "unit": "수", "fn": lambda s: s.get("mort"), "sum": True},
    "mortality_per_10k": {"label": "폐사율(1만 수당 하루)", "unit": "수", "fn": _ratio("mort", "birds", 10000)},
    "feed_per_bird_g": {"label": "수당 사료 섭취량", "unit": "g", "fn": _ratio("feed_g", "birds_feed")},
    "feed_per_egg_g": {"label": "알 1개당 사료", "unit": "g", "fn": _ratio("fe_feed_g", "fe_eggs"),
                       "note": "산란율 50% 이상인 날만 계산 (산란 초기·육성기 제외)"},
    "water_per_bird_ml": {"label": "수당 급수량", "unit": "mL", "fn": _ratio("water_ml", "birds_water")},
    "water_feed_ratio": {"label": "수사비", "unit": "", "fn": _ratio("wf_water", "wf_feed")},
    "egg_weight": {"label": "난중", "unit": "g", "fn": _ratio("ew_sum", "ew_n")},
    "temp_max": {"label": "최고 온도", "unit": "℃", "fn": _ratio("tmax_sum", "tmax_n")},
    "temp_min": {"label": "최저 온도", "unit": "℃", "fn": _ratio("tmin_sum", "tmin_n")},
    "humidity": {"label": "습도", "unit": "%", "fn": _ratio("hum_sum", "hum_n")},
}
for g, name in EGG_GRADES.items():
    METRICS[f"share_{g}"] = {"label": f"{name} 비율", "unit": "%", "fn": _ratio(f"g_{g}", "eggs", 100)}

X_AXES = {"date": "날짜", "week": "주(날짜)", "month": "월", "age_days": "일령", "age_weeks": "주령"}
GROUPS = {"flock": "계군별", "house": "계사별", "farm": "농장별", "program": "프로그램 적용 여부", "none": "전체 합계"}

MAX_SERIES = 60
LAY_VALID_MAX = 105.0


def catalog() -> dict:
    return {
        "sources": SOURCES,
        "metrics": {k: {"label": v["label"], "unit": v["unit"]} for k, v in METRICS.items()},
        "x_axes": X_AXES,
        "groups": GROUPS,
    }


FEED_PER_EGG_MIN_LAY = 50  # 산란 초기엔 알이 적어 사료/알이 수천 g로 튄다


def _accumulate(s: dict, r: DailyRecord) -> None:
    s["n"] += 1
    eggs = None
    vals = [r.egg(g) for g in EGG_GRADES]
    if any(v is not None for v in vals):
        eggs = sum(v or 0 for v in vals)
    if r.bird_count:
        s["birds"] += r.bird_count
        s["mort"] += r.mortality or 0
        if eggs is not None and eggs / r.bird_count * 100 <= LAY_VALID_MAX:
            s["eggs_lay"] += eggs
            s["birds_lay"] += r.bird_count
        if r.feed_kg:
            s["feed_g"] += r.feed_kg * 1000
            s["birds_feed"] += r.bird_count
        if r.water_l:
            s["water_ml"] += r.water_l * 1000
            s["birds_water"] += r.bird_count
    if eggs is not None:
        s["eggs"] += eggs
        for g in EGG_GRADES:
            s[f"g_{g}"] += r.egg(g) or 0
        lay = eggs / r.bird_count * 100 if r.bird_count else None
        if r.feed_kg and eggs and lay is not None and FEED_PER_EGG_MIN_LAY <= lay <= LAY_VALID_MAX:
            s["fe_feed_g"] += r.feed_kg * 1000
            s["fe_eggs"] += eggs
    if r.water_l and r.feed_kg:
        s["wf_water"] += r.water_l
        s["wf_feed"] += r.feed_kg
    for attr, key in (("egg_weight", "ew"), ("temp_max", "tmax"), ("temp_min", "tmin"), ("humidity", "hum")):
        v = getattr(r, attr)
        if v is not None:
            s[f"{key}_sum"] += v
            s[f"{key}_n"] += 1


def run_query(db: Session, q: dict, allowed_farm_ids: set[int] | None) -> dict:
    metric = q.get("metric", "lay_rate")
    x = q.get("x", "date")
    group = q.get("group", "flock")
    if metric not in METRICS or x not in X_AXES or group not in GROUPS:
        raise ValueError("지원하지 않는 지표·축·묶음입니다")

    farm_ids = set(q.get("farm_ids") or [])
    if allowed_farm_ids is not None:
        farm_ids = (farm_ids & allowed_farm_ids) if farm_ids else allowed_farm_ids
    qry = db.query(DailyRecord, Flock).outerjoin(Flock, DailyRecord.flock_id == Flock.id)
    if farm_ids:
        qry = qry.filter(DailyRecord.farm_id.in_(farm_ids))
    if q.get("flock_ids"):
        qry = qry.filter(DailyRecord.flock_id.in_(q["flock_ids"]))
    if q.get("house_ids"):
        qry = qry.filter(DailyRecord.house_id.in_(q["house_ids"]))
    if q.get("date_from"):
        qry = qry.filter(DailyRecord.date >= dt.date.fromisoformat(q["date_from"]))
    if q.get("date_to"):
        qry = qry.filter(DailyRecord.date <= dt.date.fromisoformat(q["date_to"]))
    prog = q.get("program", "any")
    if prog == "applied":
        qry = qry.filter(Flock.program_name.isnot(None))
    elif prog == "not":
        qry = qry.filter(Flock.program_name.is_(None))
    house_kind = q.get("house_kind", "laying")
    if house_kind in ("laying", "rearing"):
        qry = qry.join(House, DailyRecord.house_id == House.id).filter(House.kind == house_kind)

    age_from, age_to = q.get("age_from"), q.get("age_to")
    houses = {h.id: h for h in db.query(House)}
    farms = {f.id: f for f in db.query(Farm)}

    buckets: dict[tuple, dict] = defaultdict(lambda: defaultdict(float))
    labels: dict[str, str] = {}
    for r, f in qry.yield_per(5000):
        age = (r.date - f.placed_on).days + AGE_DAY_BASE if f else None
        if (age_from or age_to) and age is None:
            continue
        if age_from and age < age_from:
            continue
        if age_to and age > age_to:
            continue
        if x == "date":
            xv = r.date.isoformat()
        elif x == "week":
            xv = (r.date - dt.timedelta(days=r.date.weekday())).isoformat()
        elif x == "month":
            xv = r.date.strftime("%Y-%m")
        elif x == "age_days":
            if age is None:
                continue
            xv = age
        else:
            if age is None:
                continue
            xv = age // 7
        if group == "flock":
            if not f:
                continue
            gk = f"f{f.id}"
            labels[gk] = f"{f.placed_on:%y.%m.%d} 입추 ({houses[r.house_id].name})" + (" ★" if f.program_name else "")
            if len(farm_ids) != 1:
                labels[gk] = f"{farms[r.farm_id].name} " + labels[gk]
        elif group == "house":
            gk = f"h{r.house_id}"
            labels[gk] = houses[r.house_id].name if len(farm_ids) == 1 else f"{farms[r.farm_id].name} {houses[r.house_id].name}"
        elif group == "farm":
            gk = f"a{r.farm_id}"
            labels[gk] = farms[r.farm_id].name
        elif group == "program":
            applied = bool(f and f.program_name)
            gk = "p1" if applied else "p0"
            labels[gk] = "프로그램 적용" if applied else "미적용"
        else:
            gk = "all"
            labels[gk] = "전체"
        _accumulate(buckets[(gk, xv)], r)

    fn = METRICS[metric]["fn"]
    series_pts: dict[str, list] = defaultdict(list)
    for (gk, xv), s in buckets.items():
        v = fn(s)
        if v is not None:
            series_pts[gk].append([xv, round(v, 3)])
    series = []
    for gk, pts in series_pts.items():
        pts.sort(key=lambda p: p[0])
        series.append({"key": gk, "label": labels[gk], "points": pts})
    series.sort(key=lambda s: s["label"])
    truncated = len(series) > MAX_SERIES
    if truncated:
        series.sort(key=lambda s: -len(s["points"]))
        series = sorted(series[:MAX_SERIES], key=lambda s: s["label"])

    # 7일 이동평균 (일 단위 x축만)
    if q.get("smooth") and x in ("date", "age_days"):
        for s in series:
            pts = s["points"]
            out = []
            for i, (xv, _) in enumerate(pts):
                win = [p[1] for p in pts[max(0, i - 3): i + 4]]
                if len(win) >= 4:
                    out.append([xv, round(sum(win) / len(win), 3)])
            s["points"] = out

    return {
        "metric": {"code": metric, "label": METRICS[metric]["label"], "unit": METRICS[metric]["unit"],
                   "note": METRICS[metric].get("note")},
        "x": {"code": x, "label": X_AXES[x]},
        "group": {"code": group, "label": GROUPS[group]},
        "series": series,
        "truncated": truncated,
        "record_count": sum(int(s["n"]) for s in buckets.values()),
    }
