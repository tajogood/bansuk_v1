"""분석기의 부검·검사 데이터 출처. 생산 기록(explore.py)과 같은 모양의 결과를 낸다.

부검 기록: 부검을 마친 건 (부검일 기준). 지표 = 부검 건수, 신고 폐사수.
검사 결과: 발행된 검사 (채취일 기준). 지표 = 검사 건수, 양성 건수, 양성 비율, 평균 역가군(항원 하나 고를 때).
백신 접종: 실제 접종 기록 (접종일 기준). 지표 = 접종 건수, 접종 수수. 질병별은 혼합백신 성분마다 한 번씩 센다.
"""
from __future__ import annotations

import datetime as dt
from collections import defaultdict

from sqlalchemy.orm import Session

from ..lab_catalog import ANTIGENS, DISEASE_LABELS
from ..models import Farm, Flock, House, LabSample, LabSubmission, NecropsyCase, SeroResult, Vaccination, Vaccine
from ..settings import AGE_DAY_BASE

EVENT_SOURCES = {
    "necropsy": {
        "label": "부검 기록",
        "metrics": {
            "cases": {"label": "부검 건수", "unit": "건", "note": "최종 진단(없으면 의심 질병) 기준. 질병이 여러 개면 질병마다 한 번씩 셉니다"},
            "dead_reported": {"label": "신고 폐사수", "unit": "수"},
        },
        "groups": {"disease": "질병별", "farm": "농장별", "house": "계사별", "region": "지역별", "none": "전체 합계"},
    },
    "lab": {
        "label": "검사 결과",
        "metrics": {
            "tests": {"label": "검사 건수", "unit": "건"},
            "positive": {"label": "양성 건수", "unit": "건", "note": "대조를 뺀 시료 중 하나라도 양성이면 양성 (PCR·배양)"},
            "positive_rate": {"label": "양성 비율", "unit": "%", "note": "대조를 뺀 시료 중 하나라도 양성이면 양성 (PCR·배양)"},
            "titer_mean": {"label": "평균 역가군", "unit": "", "note": "혈청 검사의 층·차량별 평균을 시료수로 가중 평균"},
        },
        "groups": {"disease": "질병별", "antigen": "항원별", "flock": "계군별", "house": "계사별", "farm": "농장별",
                   "region": "지역별", "none": "전체 합계"},
    },
    "vaccination": {
        "label": "백신 접종",
        "metrics": {
            "vaccinations": {"label": "접종 건수", "unit": "건"},
            "birds_vaccinated": {"label": "접종 수수", "unit": "수", "note": "접종 기록에 적은 수수 (없으면 0)"},
        },
        "groups": {"vaccine": "백신별", "disease": "대상 질병별", "flock": "계군별", "house": "계사별", "farm": "농장별",
                   "region": "지역별", "none": "전체 합계"},
    },
}
X_AXES = {"week": "주(날짜)", "month": "월", "date": "날짜", "age_weeks": "주령", "age_days": "일령"}
MAX_SERIES = 60


def catalog() -> dict:
    return {
        k: {"label": v["label"], "metrics": {m: {"label": d["label"], "unit": d["unit"]} for m, d in v["metrics"].items()},
            "groups": v["groups"], "x_axes": X_AXES}
        for k, v in EVENT_SOURCES.items()
    }


def _xv(x: str, day: dt.date, age: int | None):
    if x == "date":
        return day.isoformat()
    if x == "week":
        return (day - dt.timedelta(days=day.weekday())).isoformat()
    if x == "month":
        return day.strftime("%Y-%m")
    if age is None:
        return None
    return age if x == "age_days" else age // 7


def run_events(db: Session, q: dict, allowed_farm_ids: set[int] | None) -> dict:
    source = q["source"]
    spec = EVENT_SOURCES[source]
    metric, x, group = q.get("metric"), q.get("x", "week"), q.get("group", "disease")
    if metric not in spec["metrics"] or x not in X_AXES or group not in spec["groups"]:
        raise ValueError("지원하지 않는 지표·축·묶음입니다")
    farm_ids = set(q.get("farm_ids") or [])
    if allowed_farm_ids is not None:
        farm_ids = (farm_ids & allowed_farm_ids) if farm_ids else allowed_farm_ids
    d0 = dt.date.fromisoformat(q["date_from"]) if q.get("date_from") else None
    d1 = dt.date.fromisoformat(q["date_to"]) if q.get("date_to") else None
    age_from, age_to = q.get("age_from"), q.get("age_to")
    want_disease, want_antigen = q.get("disease") or None, q.get("antigen") or None

    farms = {f.id: f for f in db.query(Farm)}
    houses = {h.id: h for h in db.query(House)}
    flocks = {f.id: f for f in db.query(Flock)}
    one_farm = len(farm_ids) == 1

    # 사건 하나 = (농장, 계사, 계군, 날짜, 질병, 항원, 값 dict)
    rows: list[tuple] = []
    if source == "necropsy":
        qry = db.query(NecropsyCase).filter(NecropsyCase.status.in_(("done", "shared")), NecropsyCase.performed_at.isnot(None))
        if farm_ids:
            qry = qry.filter(NecropsyCase.farm_id.in_(farm_ids))
        for c in qry:
            day = c.performed_at.date()
            src = c.final_diseases if c.final_diseases else c.suspected  # 최종 진단 우선
            dis = [d for d in (src or []) if isinstance(d, str) and d.isascii()] or ["other"]
            for d in dis if group == "disease" or want_disease else dis[:1]:
                rows.append((c.farm_id, c.house_id, c.flock_id, day, d, None, {"cases": 1, "dead": c.dead_count or 0}))
    elif source == "vaccination":
        vaccines = {v.id: v for v in db.query(Vaccine)}
        qry = db.query(Vaccination)
        if farm_ids:
            qry = qry.join(Flock, Flock.id == Vaccination.flock_id).filter(Flock.farm_id.in_(farm_ids))
        for v in qry:
            fl = flocks.get(v.flock_id)
            vac = vaccines.get(v.vaccine_id)
            if not fl:
                continue
            dis = [c.get("disease") for c in (vac.components or []) if isinstance(c, dict) and c.get("disease")] if vac else []
            dis = dis or ["other"]
            for d in dis if group == "disease" or want_disease else dis[:1]:
                rows.append((fl.farm_id, v.house_id, fl.id, v.date, d, f"v{v.vaccine_id}",
                             {"vaccinations": 1, "birds": v.birds or 0, "vname": vac.name if vac else "?"}))
    else:
        qry = db.query(LabSubmission).filter(LabSubmission.status == "issued", LabSubmission.sampled_on.isnot(None))
        if farm_ids:
            qry = qry.filter(LabSubmission.farm_id.in_(farm_ids))
        subs = qry.all()
        sids = [s.id for s in subs]
        pos, has_rows = set(), set()
        sero: dict[int, list[SeroResult]] = defaultdict(list)
        if sids:
            for sid, res in db.query(LabSample.submission_id, LabSample.result).filter(
                LabSample.submission_id.in_(sids), LabSample.control.is_(False)
            ):
                has_rows.add(sid)
                if res == "positive":
                    pos.add(sid)
            for r in db.query(SeroResult).filter(SeroResult.submission_id.in_(sids)):
                sero[r.submission_id].append(r)
        for s in subs:
            if s.kind == "serology":
                by_ag: dict[str, list[float]] = defaultdict(lambda: [0.0, 0.0])
                for r in sero[s.id]:
                    if r.mean is not None and r.n:
                        by_ag[r.antigen][0] += r.mean * r.n
                        by_ag[r.antigen][1] += r.n
                for ag, (tot, n) in by_ag.items():
                    rows.append((s.farm_id, s.house_id, s.flock_id, s.sampled_on, ANTIGENS.get(ag, ("", None))[1], ag,
                                 {"tests": 1, "titer_sum": tot, "titer_n": n}))
            else:
                rows.append((s.farm_id, s.house_id, s.flock_id, s.sampled_on, s.disease or "other", None,
                             {"tests": 1, "judged": 1 if s.id in has_rows else 0, "positive": 1 if s.id in pos else 0}))

    buckets: dict[tuple, dict] = defaultdict(lambda: defaultdict(float))
    labels: dict[str, str] = {}
    count = 0
    for farm_id, house_id, flock_id, day, disease, antigen, vals in rows:
        if (d0 and day < d0) or (d1 and day > d1):
            continue
        if want_disease and disease != want_disease:
            continue
        if want_antigen and antigen != want_antigen:
            continue
        if metric == "titer_mean" and antigen is None:
            continue
        if metric in ("positive", "positive_rate") and antigen is not None:
            continue
        vname = vals.pop("vname", None) if source == "vaccination" else None
        fl = flocks.get(flock_id) if flock_id else None
        age = (day - fl.placed_on).days + AGE_DAY_BASE if fl else None
        if (age_from or age_to) and (age is None or (age_from and age < age_from) or (age_to and age > age_to)):
            continue
        xv = _xv(x, day, age)
        if xv is None:
            continue
        f = farms.get(farm_id)
        if group == "disease":
            gk, lab = f"d:{disease}", DISEASE_LABELS.get(disease, "기타")
        elif group == "vaccine":
            gk, lab = f"{antigen}", vname or "?"
        elif group == "antigen":
            if not antigen:
                continue
            gk, lab = f"g:{antigen}", ANTIGENS[antigen][0]
        elif group == "farm":
            gk, lab = f"a{farm_id}", f.name if f else ""
        elif group == "house":
            h = houses.get(house_id)
            if not h:
                continue
            gk, lab = f"h{house_id}", h.name if one_farm else f"{f.name if f else ''} {h.name}"
        elif group == "flock":
            if not fl:
                continue
            h = houses.get(house_id)
            gk = f"f{fl.id}"
            lab = f"{fl.placed_on:%y.%m.%d} 입추" + (f" ({h.name})" if h else "")
            if not one_farm and f:
                lab = f"{f.name} {lab}"
        elif group == "region":
            reg = (f.region or "").split()[0] if f and f.region else "기타"
            gk, lab = f"r:{reg}", reg
        else:
            gk, lab = "all", "전체"
        labels[gk] = lab
        b = buckets[(gk, xv)]
        for k, v in vals.items():
            b[k] += v
        count += 1

    def value(b: dict):
        if metric == "cases":
            return b.get("cases") or None
        if metric == "dead_reported":
            return b.get("dead")
        if metric == "vaccinations":
            return b.get("vaccinations") or None
        if metric == "birds_vaccinated":
            return b.get("birds") if b.get("vaccinations") else None
        if metric == "tests":
            return b.get("tests") or None
        if metric == "positive":
            return b.get("positive", 0) if b.get("tests") else None
        if metric == "positive_rate":
            return b["positive"] / b["judged"] * 100 if b.get("judged") else None
        return b["titer_sum"] / b["titer_n"] if b.get("titer_n") else None

    pts: dict[str, list] = defaultdict(list)
    for (gk, xv), b in buckets.items():
        v = value(b)
        if v is not None:
            pts[gk].append([xv, round(v, 3)])
    series = [{"key": gk, "label": labels[gk], "points": sorted(p, key=lambda z: z[0])} for gk, p in pts.items()]
    series.sort(key=lambda s: -sum(p[1] for p in s["points"]) if metric in ("cases", "tests", "positive", "dead_reported", "vaccinations", "birds_vaccinated") else s["label"])
    truncated = len(series) > MAX_SERIES
    series = series[:MAX_SERIES]
    m = spec["metrics"][metric]
    return {
        "metric": {"code": metric, "label": m["label"], "unit": m["unit"], "note": m.get("note")},
        "x": {"code": x, "label": X_AXES[x]},
        "group": {"code": group, "label": spec["groups"][group]},
        "series": series,
        "truncated": truncated,
        "record_count": count,
    }
