"""생산 지표 계산과 입력 직후 경고.

산식은 설계서 5-1절. 경고 임계값은 설계서 5-4절의 '출발값'이며 운영하며 조정한다.
"""
from __future__ import annotations

import statistics

from ..models import DailyRecord
from ..settings import EGG_GRADES

# --- 경고 출발값 (설계서 5-4) ---
MORTALITY_MULTIPLIER = 2.0  # 최근 14일 중앙값의 몇 배부터
MORTALITY_MIN_PER_10K = 3.0  # 1만 수당 이 이상일 때만
LAY_DROP_PCT_POINTS = 5.0  # 직전 7일 평균 대비 하루 하락 (%p)
INTAKE_DROP_RATIO = 0.10  # 직전 3일 평균 대비 감소율 (사료·급수)


def total_eggs(r: DailyRecord) -> int | None:
    vals = [r.egg(g) for g in EGG_GRADES]
    if all(v is None for v in vals):
        return None
    return sum(v or 0 for v in vals)


def compute(r: DailyRecord) -> dict:
    """한 기록의 계산 지표. 값이 없으면 None."""
    eggs = total_eggs(r)
    n = r.bird_count or None
    out: dict = {
        "total_eggs": eggs,
        "lay_rate": round(eggs / n * 100, 1) if eggs is not None and n else None,
        "feed_per_bird_g": round(r.feed_kg * 1000 / n, 1) if r.feed_kg and n else None,
        "water_feed_ratio": round(r.water_l / r.feed_kg, 2) if r.water_l and r.feed_kg else None,
        "feed_per_egg_g": round(r.feed_kg * 1000 / eggs, 1) if r.feed_kg and eggs else None,
        "mortality_per_10k": round((r.mortality or 0) / n * 10000, 1)
        if n and r.mortality is not None
        else None,
    }
    if eggs:
        out["grade_share"] = {
            g: round((r.egg(g) or 0) / eggs * 100, 1) for g in EGG_GRADES if r.egg(g)
        }
    return out


def warnings(r: DailyRecord, history: list[DailyRecord]) -> list[dict]:
    """저장 직후 화면에 바로 보여줄 경고. history는 같은 계사의 이전 기록(최근 순 아님, 날짜 오름차순)."""
    out: list[dict] = []
    m = compute(r)
    hm = [compute(h) for h in history]

    lay = m["lay_rate"]
    if lay is not None and lay > 100:
        out.append(
            {
                "level": "error",
                "code": "lay_over_100",
                "message": f"산란율이 {lay}%로 100%를 넘습니다. 집란 시간이나 입력값을 확인해 주세요.",
            }
        )

    # 폐사 급증
    past_mort = [x["mortality_per_10k"] for x in hm[-14:] if x["mortality_per_10k"] is not None]
    cur_mort = m["mortality_per_10k"]
    if cur_mort is not None and len(past_mort) >= 5:
        med = statistics.median(past_mort)
        if cur_mort >= MORTALITY_MIN_PER_10K and cur_mort >= med * MORTALITY_MULTIPLIER:
            # 농장주가 바로 이해하도록 마릿수로 말한다
            usual = statistics.median([h.mortality for h in history[-14:] if h.mortality is not None])
            if usual > 0:
                msg = f"폐사 {r.mortality}수. 평소 하루 약 {usual:.0f}수의 {r.mortality / usual:.0f}배입니다."
            else:
                msg = f"폐사 {r.mortality}수. 평소보다 많습니다."
            out.append({"level": "warning", "code": "mortality_spike", "message": msg})

    # 산란 하락
    past_lay = [x["lay_rate"] for x in hm[-7:] if x["lay_rate"] is not None and x["lay_rate"] <= 100]
    if lay is not None and lay <= 100 and len(past_lay) >= 3:
        avg = sum(past_lay) / len(past_lay)
        if avg - lay >= LAY_DROP_PCT_POINTS:
            out.append(
                {
                    "level": "warning",
                    "code": "lay_drop",
                    "message": f"산란율이 최근 평균({avg:.1f}%)보다 {avg - lay:.1f}%p 낮습니다.",
                }
            )

    # 사료·급수 급감
    for key, label in (("feed_per_bird_g", "사료 섭취량"), ("water_l", "급수량")):
        if key == "water_l":
            cur = r.water_l
            past = [h.water_l for h in history[-3:] if h.water_l]
        else:
            cur = m[key]
            past = [x[key] for x in hm[-3:] if x[key]]
        if cur and len(past) >= 2:
            avg = sum(past) / len(past)
            if cur < avg * (1 - INTAKE_DROP_RATIO):
                out.append(
                    {
                        "level": "warning",
                        "code": f"{key}_drop",
                        "message": f"{label}이 최근 평균보다 {(1 - cur / avg) * 100:.0f}% 적습니다.",
                    }
                )
    return out
