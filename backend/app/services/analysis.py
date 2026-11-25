"""계군 성적 분석. 반석 정식 보고서와 농장주 대시보드가 같은 계산을 쓴다.

비교 기준은 '같은 농장의 과거 계군'이고, 날짜가 아니라 일령으로 맞춘다 (설계서 5-3).
산란율은 집란 시점에 따라 하루 값이 흔들려 7일 중심 이동평균으로 본다.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import statistics
from collections import defaultdict

from sqlalchemy.orm import Session

from ..models import DailyRecord, Flock, FlockLocation, House
from ..settings import AGE_DAY_BASE, EGG_GRADES
from .metrics import total_eggs

LAY_VALID_MAX = 105.0  # 이보다 높은 하루 산란율은 집란 시점 오류로 보고 곡선에서 뺀다
MIN_BAND_FLOCKS = 3  # 기준선 띠를 그리려면 그 일령에 최소 이 수의 과거 계군이 필요
MA_HALF = 3  # 7일 중심 이동평균


def _age(flock: Flock, day: dt.date) -> int:
    return (day - flock.placed_on).days + AGE_DAY_BASE


def _records(db: Session, flock_id: int) -> list[DailyRecord]:
    return db.query(DailyRecord).filter(DailyRecord.flock_id == flock_id).order_by(DailyRecord.date).all()


def _lay_by_age(flock: Flock, recs: list[DailyRecord]) -> dict[int, float]:
    out: dict[int, float] = {}
    for r in recs:
        eggs = total_eggs(r)
        if eggs is None or not r.bird_count:
            continue
        v = eggs / r.bird_count * 100
        if 0 < v <= LAY_VALID_MAX:
            out[_age(flock, r.date)] = v
    return out


def _moving_avg(series: dict[int, float]) -> dict[int, float]:
    out = {}
    for a in series:
        win = [series[x] for x in range(a - MA_HALF, a + MA_HALF + 1) if x in series]
        if len(win) >= 4:
            out[a] = sum(win) / len(win)
    return out


def _quantile(sorted_vals: list[float], q: float) -> float:
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    pos = q * (len(sorted_vals) - 1)
    lo = int(pos)
    hi = min(lo + 1, len(sorted_vals) - 1)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (pos - lo)


def window_summary(flock: Flock, recs: list[DailyRecord], a0: int, a1: int) -> dict | None:
    """일령 구간 [a0, a1]의 합계 기반 지표. 하루 비율의 평균이 아니라 총량의 비율로 계산한다."""
    w = [r for r in recs if a0 <= _age(flock, r.date) <= a1 and r.bird_count]
    if not w:
        return None
    birds = sum(r.bird_count for r in w)
    lay_rows = [r for r in w if total_eggs(r) is not None and total_eggs(r) / r.bird_count * 100 <= LAY_VALID_MAX]
    eggs = sum(total_eggs(r) for r in lay_rows)
    lay_birds = sum(r.bird_count for r in lay_rows)
    feed_rows = [r for r in w if r.feed_kg]
    feed = sum(r.feed_kg for r in feed_rows)
    feed_birds = sum(r.bird_count for r in feed_rows)
    feed_egg_rows = [r for r in feed_rows if total_eggs(r)]
    fe_feed = sum(r.feed_kg for r in feed_egg_rows) * 1000
    fe_eggs = sum(total_eggs(r) for r in feed_egg_rows)
    mass_rows = [r for r in feed_egg_rows if r.egg_weight]
    mass = sum(total_eggs(r) * r.egg_weight for r in mass_rows)  # g
    mass_feed = sum(r.feed_kg for r in mass_rows) * 1000
    ew = [r.egg_weight for r in w if r.egg_weight]
    water_rows = [r for r in feed_rows if r.water_l]
    mort = sum(r.mortality or 0 for r in w)
    grades = {}
    if eggs:
        for g in EGG_GRADES:
            s = sum(r.egg(g) or 0 for r in lay_rows)
            if s:
                grades[g] = round(s / eggs * 100, 2)
    span = a1 - a0 + 1
    return {
        "days": len(w),
        "coverage": round(len(w) / span, 3),
        "lay_rate": round(eggs / lay_birds * 100, 1) if lay_birds and eggs else None,
        "feed_per_bird_g": round(feed * 1000 / feed_birds, 1) if feed_birds else None,
        "feed_per_egg_g": round(fe_feed / fe_eggs, 1) if fe_eggs else None,
        "feed_per_kg_egg": round(mass_feed / mass, 3) if mass else None,
        "egg_weight_g": round(statistics.mean(ew), 2) if ew else None,
        "water_feed_ratio": round(sum(r.water_l for r in water_rows) / sum(r.feed_kg for r in water_rows), 2)
        if water_rows
        else None,
        "mortality_per_10k_day": round(mort / birds * 10000, 2) if birds else None,
        "grade_share": grades,
    }


def curve_points(ma: dict[int, float]) -> dict:
    """50% 산란 일령, 7일 평균 피크와 그 일령, 90% 이상 유지 일수."""
    if not ma:
        return {"age_at_50": None, "peak": None, "peak_age": None, "days_over_90": 0}
    ages = sorted(ma)
    a50 = next((a for a in ages if ma[a] >= 50), None)
    peak_age = max(ages, key=lambda a: ma[a])
    return {
        "age_at_50": a50,
        "peak": round(ma[peak_age], 1),
        "peak_age": peak_age,
        "days_over_90": sum(1 for a in ages if ma[a] >= 90),
    }


METRICS_HIGHER_BETTER = {
    "lay_rate": True,
    "egg_weight_g": True,
    "feed_per_bird_g": None,  # 높고 낮음 자체로 좋고 나쁨을 말하지 않음
    "feed_per_egg_g": False,
    "feed_per_kg_egg": False,
    "water_feed_ratio": None,
    "mortality_per_10k_day": False,
}


def flock_report(
    db: Session,
    flock_id: int,
    age_from: int | None = None,
    age_to: int | None = None,
    baseline: str = "past",  # past: 이 계군보다 먼저 입추한 같은 농장 계군 | all: 같은 농장 전체
) -> dict:
    target = db.get(Flock, flock_id)
    if target is None:
        raise ValueError("계군을 찾을 수 없습니다")
    t_recs = _records(db, flock_id)
    t_lay = _lay_by_age(target, t_recs)
    t_ma = _moving_avg(t_lay)

    # 비교 구간: 지정이 없으면 7일 평균 산란율 50% 도달부터 마지막 기록까지.
    # 산란 개시 직전·직후는 며칠 차이로 비율이 크게 달라져 성적 비교를 왜곡하므로 뺀다.
    laid = sorted(a for a, v in t_lay.items() if v >= 5)
    a50 = next((a for a in sorted(t_ma) if t_ma[a] >= 50), None)
    a0 = age_from if age_from is not None else (a50 or (laid[0] if laid else None))
    a1 = age_to if age_to is not None else (laid[-1] if laid else None)

    q = db.query(Flock).filter(Flock.farm_id == target.farm_id, Flock.id != target.id)
    if baseline == "past":
        q = q.filter(Flock.placed_on < target.placed_on)
    others = q.order_by(Flock.placed_on).all()

    base_series: dict[int, dict[int, float]] = {}
    base_recs: dict[int, list[DailyRecord]] = {}
    for f in others:
        recs = _records(db, f.id)
        ma = _moving_avg(_lay_by_age(f, recs))
        if ma:
            base_series[f.id] = ma
            base_recs[f.id] = recs

    # 일령별 기준선 띠
    lo_age = (a0 or 0) - 21
    hi_age = (a1 or 0) + 21
    band = []
    for a in range(max(lo_age, 1), hi_age + 1):
        vals = sorted(s[a] for s in base_series.values() if a in s)
        point = {"age": a, "target": round(t_ma[a], 1) if a in t_ma else None}
        if len(vals) >= MIN_BAND_FLOCKS:
            point.update(
                {
                    "median": round(statistics.median(vals), 1),
                    "p10": round(_quantile(vals, 0.1), 1),
                    "p90": round(_quantile(vals, 0.9), 1),
                    "n": len(vals),
                }
            )
        band.append(point)

    # 구간 지표와 순위
    comparison = None
    if a0 is not None and a1 is not None:
        t_sum = window_summary(target, t_recs, a0, a1)
        peers = []
        for f in others:
            if f.id not in base_recs:
                continue
            s = window_summary(f, base_recs[f.id], a0, a1)
            if s and s["coverage"] >= 0.7:
                peers.append((f, s))
        rows = []
        for key, higher in METRICS_HIGHER_BETTER.items():
            tv = t_sum.get(key) if t_sum else None
            pv = sorted(s[key] for _, s in peers if s.get(key) is not None)
            row = {"metric": key, "target": tv, "n": len(pv)}
            if pv:
                row["median"] = round(statistics.median(pv), 3)
                row["p10"] = round(_quantile(pv, 0.1), 3)
                row["p90"] = round(_quantile(pv, 0.9), 3)
                if tv is not None:
                    # 1위 = 가장 좋은 값 (방향이 없는 지표는 큰 값 기준)
                    better = sum(1 for v in pv if (v < tv if higher is False else v > tv))
                    row["rank"] = better + 1
                    row["of"] = len(pv) + 1
                    row["higher_is_better"] = higher
            rows.append(row)
        grade_rows = []
        for g in EGG_GRADES:
            tv = (t_sum or {}).get("grade_share", {}).get(g)
            pv = [s["grade_share"].get(g, 0) for _, s in peers if s.get("grade_share")]
            med = statistics.median(pv) if pv else 0
            if not tv and round(med, 1) == 0:  # 양쪽 모두 0인 규격은 표에서 뺀다
                continue
            grade_rows.append(
                {"grade": g, "label": EGG_GRADES[g], "target": tv or 0, "median": round(statistics.median(pv), 2) if pv else None}
            )
        comparison = {
            "age_from": a0,
            "age_to": a1,
            "target": t_sum,
            "peer_count": len(peers),
            "metrics": rows,
            "grades": grade_rows,
            "peers": [
                {"flock_id": f.id, "name": f.name, "placed_on": f.placed_on.isoformat(), "program": f.program_name, **s}
                for f, s in peers
            ],
        }

    # 데이터 품질과 지문
    all_recs = t_recs + [r for rs in base_recs.values() for r in rs]
    fingerprint = _fingerprint(all_recs)
    over_100 = sum(
        1 for r in t_recs if total_eggs(r) and r.bird_count and total_eggs(r) / r.bird_count * 100 > LAY_VALID_MAX
    )
    houses = {
        loc.house_id: db.get(House, loc.house_id).name
        for loc in db.query(FlockLocation).filter(FlockLocation.flock_id == flock_id)
    }
    cautions = []
    if comparison and comparison["peer_count"] < 3:
        cautions.append(f"비교할 과거 계군이 {comparison['peer_count']}개뿐이라 순위는 참고용입니다.")
    if comparison and comparison["target"] and comparison["target"]["coverage"] < 0.9:
        cautions.append(
            f"비교 구간 중 {round((1 - comparison['target']['coverage']) * 100)}%의 날에 기록이 없습니다."
        )
    if over_100:
        cautions.append(f"산란율이 {LAY_VALID_MAX:.0f}%를 넘은 {over_100}일은 집란 시점 문제로 보고 곡선에서 뺐습니다.")
    cautions.append("사료 회사·단계, 입추 계절, 부화장·품종, 점등 조건은 계군마다 다를 수 있으며 이 비교에서 보정하지 않았습니다.")

    return {
        "flock": {
            "id": target.id,
            "name": target.name,
            "placed_on": target.placed_on.isoformat(),
            "placed_count": target.placed_count,
            "breed": target.breed,
            "hatchery": target.hatchery,
            "program": target.program_name,
            "houses": list(houses.values()),
            "status": target.status,
        },
        "baseline": baseline,
        "curve": curve_points(t_ma),
        "baseline_curve": {
            "median_age_at_50": _median_or_none([curve_points(s)["age_at_50"] for s in base_series.values()]),
            "median_peak": _median_or_none([curve_points(s)["peak"] for s in base_series.values()]),
        },
        "band": band,
        "comparison": comparison,
        "data": {
            "target_records": len(t_recs),
            "baseline_flocks": len(base_series),
            "baseline_records": sum(len(v) for v in base_recs.values()),
            "first_date": t_recs[0].date.isoformat() if t_recs else None,
            "last_date": t_recs[-1].date.isoformat() if t_recs else None,
            "lay_over_limit_days": over_100,
            "fingerprint": fingerprint,
        },
        "cautions": cautions,
        "method": {
            "age_base": AGE_DAY_BASE,
            "moving_average_days": MA_HALF * 2 + 1,
            "lay_valid_max": LAY_VALID_MAX,
            "min_band_flocks": MIN_BAND_FLOCKS,
            "peer_min_coverage": 0.7,
        },
    }


def _median_or_none(vals):
    vals = [v for v in vals if v is not None]
    return statistics.median(vals) if vals else None


def _fingerprint(recs: list[DailyRecord]) -> str:
    """보고서에 쓴 원자료의 지문. 같은 데이터면 같은 값이 나와 재현 여부를 확인할 수 있다."""
    keys = ["bird_count", "mortality", "feed_kg", "water_l", "egg_weight"] + [f"egg_{g}" for g in EGG_GRADES]
    rows = sorted(
        (r.house_id, r.date.isoformat(), [getattr(r, k) for k in keys]) for r in recs
    )
    return hashlib.sha256(json.dumps(rows, default=str).encode()).hexdigest()[:16]


def house_trends(db: Session, farm_id: int, end: dt.date, days: int = 28) -> list[dict]:
    """농장주 대시보드: 동별 최근 추이와 같은 농장 과거 계군 같은 일령 대비 위치."""
    from ..services.flocks import flock_location_at

    houses = db.query(House).filter(House.farm_id == farm_id, House.active.is_(True)).order_by(House.sort_order).all()
    start = end - dt.timedelta(days=days - 1)
    farm_flocks = db.query(Flock).filter(Flock.farm_id == farm_id).all()
    series_cache: dict[int, dict[int, float]] = {}

    def ma_for(f: Flock) -> dict[int, float]:
        if f.id not in series_cache:
            series_cache[f.id] = _moving_avg(_lay_by_age(f, _records(db, f.id)))
        return series_cache[f.id]

    out = []
    for h in houses:
        loc = flock_location_at(db, h.id, end)
        flock = db.get(Flock, loc.flock_id) if loc else None
        recs = (
            db.query(DailyRecord)
            .filter(DailyRecord.house_id == h.id, DailyRecord.date.between(start, end))
            .order_by(DailyRecord.date)
            .all()
        )
        daily = []
        for r in recs:
            eggs = total_eggs(r)
            daily.append(
                {
                    "date": r.date.isoformat(),
                    "lay_rate": round(eggs / r.bird_count * 100, 1) if eggs and r.bird_count else None,
                    "mortality": r.mortality,
                    "feed_per_bird_g": round(r.feed_kg * 1000 / r.bird_count, 1) if r.feed_kg and r.bird_count else None,
                    "water_l": r.water_l,
                    "bird_count": r.bird_count,
                }
            )
        position = None
        if flock:
            t_ma = ma_for(flock)
            age_now = _age(flock, end)
            # 최근 3일 안의 값만 '지금' 성적으로 본다 (출하가 끝난 계군의 옛 값을 보여주지 않게)
            cand = [a for a in t_ma if age_now - 3 <= a <= age_now]
            if cand:
                a = max(cand)
                peers = [ma_for(f).get(a) for f in farm_flocks if f.id != flock.id and f.placed_on < flock.placed_on]
                peers = sorted(v for v in peers if v is not None)
                position = {
                    "age_days": a,
                    "lay_7d": round(t_ma[a], 1),
                    "past_median": round(statistics.median(peers), 1) if len(peers) >= MIN_BAND_FLOCKS else None,
                    "past_n": len(peers),
                    "better_than_pct": round(sum(1 for v in peers if v < t_ma[a]) / len(peers) * 100)
                    if len(peers) >= MIN_BAND_FLOCKS
                    else None,
                }
        out.append(
            {
                "house": {"id": h.id, "name": h.name, "kind": h.kind},
                "flock": {"id": flock.id, "name": flock.name, "age_weeks": _age(flock, end) // 7, "program": flock.program_name}
                if flock
                else None,
                "daily": daily,
                "position": position,
            }
        )
    return out


def flock_csv_rows(db: Session, flock_id: int) -> list[list]:
    flock = db.get(Flock, flock_id)
    recs = _records(db, flock_id)
    names = {h.id: h.name for h in db.query(House).filter(House.farm_id == flock.farm_id)}
    header = ["date", "age_days", "house", "bird_count", "mortality", *[f"egg_{g}" for g in EGG_GRADES],
              "total_eggs", "lay_rate_pct", "feed_kg", "water_l", "egg_weight_g", "temp_min", "temp_max", "humidity", "source"]
    rows = [header]
    for r in recs:
        eggs = total_eggs(r)
        rows.append([
            r.date.isoformat(), _age(flock, r.date), names.get(r.house_id), r.bird_count, r.mortality,
            *[r.egg(g) for g in EGG_GRADES], eggs,
            round(eggs / r.bird_count * 100, 2) if eggs and r.bird_count else None,
            r.feed_kg, r.water_l, r.egg_weight, r.temp_min, r.temp_max, r.humidity, r.source,
        ])
    return rows
