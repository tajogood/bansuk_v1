"""사양관리현황 엑셀 이관.

농장이 쓰는 월별 가로형 시트(행 = 항목 × 동, 열 = 1~31일)를 일일 기록으로 바꾼다.
행 번호는 해마다 바뀌어서(2017년 162행 → 2019년 231행) A열 항목명·B열 동 이름으로 찾는다.
계산값(산란율, 수사비 등)은 가져오지 않고 원자료만 가져온다.

    python -m app.importers.sayang 파일.xlsx --farm "농장명" --dry-run   # 검증 리포트만
    python -m app.importers.sayang 파일.xlsx --farm "농장명" --csv out.csv
    python -m app.importers.sayang 파일.xlsx --farm "농장명"             # DB에 반영
"""
from __future__ import annotations

import argparse
import datetime as dt
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field

import openpyxl

# A열 항목명(공백 제거) 접두어 → 필드
SECTION_MAP: dict[str, str] = {
    "현재수수": "bird_count",
    "폐사": "mortality",
    "사료소비": "feed_kg",
    "급수량": "water_l",
    "쌍란": "egg_double",
    "왕란": "egg_jumbo",
    "특란": "egg_xl",
    "대란": "egg_l",
    "중란": "egg_m",
    "소란": "egg_s",
    "무대": "egg_mudae",
    "무중": "egg_muzung",
    "크랙": "egg_crack",
    "crack": "egg_crack",
    "파란": "egg_broken",
    "난중": "egg_weight",
    "체중": "body_weight",
    "주령": "_age",
    "계사온도": "_temp",
    "사료교체": "_feed_stage",
    "사료입고": "feed_in_kg",
    "외기온도": "_out_temp",
}
# 생산 기록이 있는 날로 보는 항목 (수수만 수식으로 이어진 빈 날은 버린다)
PRODUCTION_KEYS = {"mortality", "feed_kg", "water_l", "egg_weight", "body_weight"}
# 이관하지 않는 계산·집계 항목 (참고용 목록)
SKIPPED_SECTIONS = ["산란율", "수당사료섭취량", "수사비", "사료요구율", "총산란수", "누적산란수", "HH산란지수"]

TITLE_RE = re.compile(r"(\d{4})\s*년?\s*\(\s*(\d{1,2})\s*월")
SHEET_RE = re.compile(r"^\s*(\d{2}|\d{4})\s*[.\s]?\s*(\d{1,2})\D*$")
BODY_WT_RE = re.compile(r"평균체중\s*[:：]?\s*([\d,]+(?:\.\d+)?)")
UNIFORM_RE = re.compile(r"균일도\s*[:：]?\s*(\d+(?:\.\d+)?)")
HOUSE_RE = re.compile(r"^(\d+)동|^(육성사|육성동)")
FEED_BRAND_RE = re.compile(r"\((.+?)\)")


@dataclass
class DayRow:
    date: dt.date
    house: str
    values: dict = field(default_factory=dict)
    age_days: int | None = None
    feed_brand: str | None = None
    feed_stage: str | None = None


@dataclass
class Report:
    months: list[str] = field(default_factory=list)
    skipped_sheets: list[str] = field(default_factory=list)
    missing_months: list[str] = field(default_factory=list)
    rows: int = 0
    lay_over_100: list[tuple[str, str, float]] = field(default_factory=list)
    houses: set[str] = field(default_factory=set)
    flocks: list[dict] = field(default_factory=list)
    title_conflicts: list[str] = field(default_factory=list)
    duplicate_sheets: list[str] = field(default_factory=list)

    def text(self) -> str:
        months = sorted(self.months)
        lines = [
            f"월 시트 {len(months)}개: {months[0] if months else '-'} ~ {months[-1] if months else '-'}",
            f"일일 기록 {self.rows}건, 동: {', '.join(sorted(self.houses, key=_house_sort))}",
        ]
        if self.missing_months:
            lines.append(f"빠진 달: {', '.join(self.missing_months)}")
        if self.skipped_sheets:
            lines.append(f"건너뛴 시트(제목에서 연월을 못 찾음): {', '.join(self.skipped_sheets)}")
        if self.duplicate_sheets:
            lines.append(f"같은 달이 이미 있어 건너뛴 시트: {', '.join(self.duplicate_sheets)}")
        if self.title_conflicts:
            lines.append("제목과 시트 이름의 연월이 달라 시트 이름을 따름: " + ", ".join(self.title_conflicts))
        if self.lay_over_100:
            lines.append(f"산란율 100% 초과 {len(self.lay_over_100)}건 (집란 시점 문제로 보임), 예: " + ", ".join(
                f"{d} {h} {r:.0f}%" for d, h, r in self.lay_over_100[:5]))
        lines.append(f"추정 계군 {len(self.flocks)}개")
        for f in self.flocks:
            lines.append(
                f"  {f['house']}: 입추 추정 {f['placed_on']} / 기록 {f['first']} ~ {f['last']} ({f['days']}일)"
            )
        return "\n".join(lines)


def _house_sort(name: str) -> tuple:
    m = re.match(r"(\d+)", name)
    return (0, int(m.group(1))) if m else (1, name)


def _num(v):
    if isinstance(v, bool) or v is None:
        return None
    if isinstance(v, (int, float)):
        return v
    s = str(v).strip().replace(",", "")
    try:
        return float(s)
    except ValueError:
        return None


def parse_workbook(path: str) -> tuple[list[DayRow], Report]:
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    rep = Report()
    out: dict[tuple[dt.date, str], DayRow] = {}
    seen_months: set[tuple[int, int]] = set()
    out_temp: dict[dt.date, tuple[float, float]] = {}

    # 시트 이름이 연월인 시트를 먼저 읽고, '복사본' 같은 시트는 같은 달이 없을 때만 쓴다.
    sheets = sorted(wb.worksheets, key=lambda w: 0 if SHEET_RE.match(w.title) else 1)
    for ws in sheets:
        rows = list(ws.iter_rows(min_row=1, max_row=260, max_col=34, values_only=True))
        if not rows or not rows[0] or not rows[0][0]:
            rep.skipped_sheets.append(ws.title)
            continue
        m = TITLE_RE.search(str(rows[0][0]))
        if not m:
            rep.skipped_sheets.append(ws.title)
            continue
        year, month = int(m.group(1)), int(m.group(2))
        sm = SHEET_RE.match(ws.title)
        if sm:
            sy = int(sm.group(1)) + (2000 if len(sm.group(1)) == 2 else 0)
            smo = int(sm.group(2))
            if 1 <= smo <= 12 and (sy, smo) != (year, month):
                rep.title_conflicts.append(f"{ws.title}(제목 {year}.{month:02d})")
                year, month = sy, smo
        if (year, month) in seen_months:  # '복사본' 등 같은 달 중복 시트
            rep.duplicate_sheets.append(ws.title)
            continue
        seen_months.add((year, month))
        rep.months.append(f"{year}.{month:02d}")

        section = None
        for r in rows:
            if r[0]:
                a = re.sub(r"\s", "", str(r[0])).lower()
                section = next((v for k, v in SECTION_MAP.items() if a.startswith(k.lower())), None)
            if section == "_out_temp":
                # 외기온도는 농장 하나에 한 줄 (B열 비어 있음)
                if r[0]:
                    for i in range(31):
                        try:
                            day = dt.date(year, month, i + 1)
                        except ValueError:
                            break
                        v = r[2 + i] if len(r) > 2 + i else None
                        parts = re.findall(r"-?\d+(?:\.\d+)?", str(v)) if v is not None else []
                        if len(parts) >= 2:
                            out_temp[day] = (float(parts[0]), float(parts[1]))
                continue
            if not section or not r[1]:
                continue
            b = re.sub(r"\s", "", str(r[1]))
            hm = HOUSE_RE.match(b)
            if not hm:
                continue
            house = f"{hm.group(1)}동" if hm.group(1) else "육성사"
            brand = FEED_BRAND_RE.search(b)
            for i in range(31):
                try:
                    day = dt.date(year, month, i + 1)
                except ValueError:
                    break
                v = r[2 + i] if len(r) > 2 + i else None
                if v is None or v == "":
                    continue
                row = out.setdefault((day, house), DayRow(date=day, house=house))
                if brand:
                    row.feed_brand = brand.group(1)
                if section == "_age":
                    # 형식이 시기마다 다르다: '333-47'(일령-주령), '57-405'(주령-일령), '406'(일령)
                    nums = [int(x) for x in re.findall(r"\d+", str(v)) if len(x) <= 4]
                    # 산란계 일령은 900일을 넘기 어렵다. 그 밖의 값(날짜 등 오입력)은 버린다.
                    nums = [n for n in nums if 0 < n <= 1200]
                    if nums:
                        row.age_days = max(nums)
                elif section == "_temp":
                    parts = re.findall(r"-?\d+(?:\.\d+)?", str(v))
                    if len(parts) >= 2:
                        row.values["temp_min"], row.values["temp_max"] = float(parts[0]), float(parts[1])
                elif section == "_feed_stage":
                    row.feed_stage = str(v).strip()[:40] or None
                elif section == "body_weight" and isinstance(v, str):
                    bw = BODY_WT_RE.search(v)
                    if bw:
                        row.values["body_weight"] = float(bw.group(1).replace(",", ""))
                    un = UNIFORM_RE.search(v)
                    if un:
                        row.values["uniformity"] = float(un.group(1))
                else:
                    n = _num(v)
                    # 수수 0은 '계군 없음'을 뜻하므로 기록하지 않는다 (입추 전 육성사 등)
                    # 육성사의 계란 칸 0 은 '해당 없음'
                    if house == "육성사" and section.startswith("egg_") and n == 0:
                        continue
                    if n is not None and n >= 0 and not (section == "bird_count" and n == 0):
                        row.values[section] = n

    # 빠진 달
    if seen_months:
        ys = sorted(seen_months)
        y, mo = ys[0]
        while (y, mo) <= ys[-1]:
            if (y, mo) not in seen_months:
                rep.missing_months.append(f"{y}.{mo:02d}")
            mo += 1
            if mo == 13:
                y, mo = y + 1, 1

    # 생산 기록이 있는 날만 (수수 칸은 수식으로 월말·미래까지 이어져 있다)
    today = dt.date.today()
    days = [
        d for d in out.values()
        if d.date <= today and any(k in PRODUCTION_KEYS or (k.startswith("egg_") and v) for k, v in d.values.items())
    ]
    for d in days:
        if d.date in out_temp:
            d.values["out_temp_min"], d.values["out_temp_max"] = out_temp[d.date]
        if d.feed_brand:
            d.values["feed_brand"] = d.feed_brand[:40]
        if d.feed_stage:
            d.values["feed_type"] = d.feed_stage
    days.sort(key=lambda d: (_house_sort(d.house), d.date))
    for d in days:
        eggs = sum(v for k, v in d.values.items() if k.startswith("egg_") and k != "egg_weight")
        n = d.values.get("bird_count")
        if eggs and n and eggs / n > 1.0:
            rep.lay_over_100.append((d.date.isoformat(), d.house, eggs / n * 100))
        rep.houses.add(d.house)
    rep.rows = len(days)
    rep.flocks = infer_flocks(days)
    return days, rep


def infer_flocks(days: list[DayRow], tolerance_days: int = 10, window: int = 3) -> list[dict]:
    """주령 행(일령)에서 입추일을 역산해 계군을 나눈다.

    가끔 주령 칸에 다른 형식의 값이 섞여서(예: 주령만 적힌 날) 하루짜리 가짜 계군이 생기므로,
    앞뒤 window일의 입추일 중앙값으로 판단한다. 중앙값이 tolerance보다 크게 바뀌면 새 계군.
    """
    import statistics

    from ..settings import AGE_DAY_BASE

    by_house: dict[str, list[DayRow]] = defaultdict(list)
    for d in days:
        by_house[d.house].append(d)
    flocks: list[dict] = []
    for house, rows in by_house.items():
        placed = [
            d.date - dt.timedelta(days=d.age_days - AGE_DAY_BASE) if d.age_days else None for d in rows
        ]
        ords = [p.toordinal() if p else None for p in placed]
        segs: list[dict] = []
        cur = None
        for i, d in enumerate(rows):
            near = [o for o in ords[max(0, i - window): i + window + 1] if o is not None]
            if not near:
                if cur:
                    cur["_rows"].append(d)
                continue
            med = statistics.median(near)
            if cur is None or abs(med - cur["_ord"]) > tolerance_days:
                cur = {"house": house, "_ord": med, "_rows": [], "_ords": []}
                segs.append(cur)
            cur["_rows"].append(d)
            if ords[i] is not None:
                cur["_ords"].append(ords[i])
        # 중앙값 창 때문에 새 계군 시작이 며칠 앞당겨질 수 있다: 입추일 이전 날짜는 앞 계군으로 돌린다
        for prev, nxt in zip(segs, segs[1:]):
            if not nxt["_ords"]:
                continue
            p_on = dt.date.fromordinal(int(statistics.median(nxt["_ords"])))
            early = [d for d in nxt["_rows"] if d.date < p_on]
            if early:
                nxt["_rows"] = [d for d in nxt["_rows"] if d.date >= p_on]
                prev["_rows"].extend(early)
                prev["_rows"].sort(key=lambda d: d.date)
                nxt["_ords"] = [o for o in nxt["_ords"] if o >= p_on.toordinal() - tolerance_days]
        for sgm in segs:
            if len(sgm["_rows"]) < 7 or not sgm["_ords"]:
                continue
            sgm["placed_on"] = dt.date.fromordinal(int(statistics.median(sgm["_ords"])))
            sgm["first"] = sgm["_rows"][0].date
            sgm["last"] = sgm["_rows"][-1].date
            sgm["days"] = len(sgm["_rows"])
            flocks.append(sgm)
    return flocks


def to_db(days: list[DayRow], rep: Report, farm_name: str) -> None:
    from ..db import Base, SessionLocal, engine
    from ..models import DailyRecord, Farm, FarmInputConfig, Flock, FlockLocation, House

    Base.metadata.create_all(engine)
    db = SessionLocal()
    farm = db.query(Farm).filter_by(name=farm_name).one_or_none()
    if farm is None:
        farm = Farm(name=farm_name, contract_type="program")
        db.add(farm)
        db.flush()
        db.add(FarmInputConfig(farm_id=farm.id, grades=["jumbo", "xl", "l", "m", "s", "double", "mudae", "broken"]))
    houses: dict[str, House] = {h.name: h for h in farm.houses}
    for name in sorted(rep.houses, key=_house_sort):
        if name not in houses:
            h = House(farm_id=farm.id, name=name, kind="rearing" if name == "육성사" else "laying",
                      sort_order=_house_sort(name)[1] if _house_sort(name)[0] == 0 else 99)
            db.add(h)
            db.flush()
            houses[name] = h

    row_flock: dict[int, int] = {}
    last_day = max(d.date for d in days)
    # 육성사 계군을 먼저 만들고, 같은 입추일(±10일)의 산란계사 구간은 그 계군의 이동으로 잇는다
    ordered = sorted(rep.flocks, key=lambda f: (0 if houses[f["house"]].kind == "rearing" else 1, f["first"]))
    rearing_flocks: list[tuple[dt.date, Flock]] = []
    for f in ordered:
        h = houses[f["house"]]
        first = f["_rows"][0]
        start = first.values.get("bird_count")
        if start is not None:
            start = int(start + first.values.get("mortality", 0))
        closed = f["last"] < last_day - dt.timedelta(days=7)
        flock = None
        if h.kind != "rearing":
            flock = next((fl for p_on, fl in rearing_flocks if abs((p_on - f["placed_on"]).days) <= 10), None)
        if flock is None:
            flock = Flock(
                farm_id=farm.id,
                name=f"{f['placed_on']:%y%m%d} 입추",
                placed_on=f["placed_on"],
                placed_count=start or 0,
            )
            db.add(flock)
            db.flush()
            if h.kind == "rearing":
                rearing_flocks.append((f["placed_on"], flock))
        flock.status = "closed" if closed else ("rearing" if h.kind == "rearing" else "laying")
        db.add(FlockLocation(flock_id=flock.id, house_id=h.id, from_date=f["first"],
                             to_date=f["last"] if closed or h.kind == "rearing" and flock.status != "rearing" else None,
                             start_count=start))
        for d in f["_rows"]:
            row_flock[id(d)] = flock.id
    db.flush()

    existing = {
        (r.house_id, r.date)
        for r in db.query(DailyRecord.house_id, DailyRecord.date).filter(DailyRecord.farm_id == farm.id)
    }
    added = 0
    for d in days:
        h = houses[d.house]
        if (h.id, d.date) in existing:
            continue
        rec = DailyRecord(farm_id=farm.id, house_id=h.id, flock_id=row_flock.get(id(d)), date=d.date, source="upload")
        for k, v in d.values.items():
            if k.startswith("egg_") and k != "egg_weight":
                v = int(v)
            elif k in ("bird_count", "mortality"):
                v = int(v)
            setattr(rec, k, v)
        rec.bird_count_manual = d.values.get("bird_count") is not None
        db.add(rec)
        added += 1
    db.commit()
    print(f"DB 반영: 농장 '{farm_name}', 신규 일일 기록 {added}건 (기존 날짜는 건너뜀)")


def write_csv(days: list[DayRow], path: str) -> None:
    import csv

    keys = sorted({k for d in days for k in d.values})
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["date", "house", "age_days", "feed_brand", "feed_stage", *keys])
        for d in days:
            w.writerow([d.date, d.house, d.age_days, d.feed_brand, d.feed_stage, *[d.values.get(k) for k in keys]])


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="사양관리현황 엑셀 이관")
    ap.add_argument("xlsx")
    ap.add_argument("--farm", required=True, help="농장 이름")
    ap.add_argument("--csv", help="변환 결과를 CSV로 저장")
    ap.add_argument("--dry-run", action="store_true", help="검증 리포트만 출력")
    a = ap.parse_args(argv)
    days, rep = parse_workbook(a.xlsx)
    print(rep.text())
    if a.csv:
        write_csv(days, a.csv)
        print(f"CSV 저장: {a.csv}")
    if not a.dry_run and not a.csv:
        to_db(days, rep, a.farm)


if __name__ == "__main__":
    main(sys.argv[1:])
