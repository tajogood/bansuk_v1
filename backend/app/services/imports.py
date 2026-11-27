"""농장 엑셀 업로드: 파싱 → 미리보기 → 반영 → (되돌리기).

규칙
- 농장마다 지정된 파서(Farm.importer)로 필수 데이터(수수·폐사·도태·규격별 산란·난중·체중·사료·급수·온습도)만 넣는다.
  계산값(산란율 등)은 넣지 않는다.
- 같은 날짜·계사에 이미 기록이 있으면:
    · 앱에서 직접 입력한 날은 그대로 둔다 (overwrite_manual을 켜면 엑셀 값으로 덮어씀)
    · 예전 업로드로 들어온 날은 새 엑셀 값으로 고친다 (월 파일을 다시 올리면 갱신)
    · 엑셀 칸이 비어 있으면 기존 값을 지우지 않는다
- 농장에 없는 계사 이름은 건너뛰고 경고 (계사를 자동으로 만들지 않음)
- 계군은 엑셀에서 만들지 않는다. 기록은 계군 관리에 등록된 계군에 자동으로 붙는다.
- 반영한 업로드는 되돌릴 수 있다. 반영 뒤 사람이 고친 날은 되돌리지 않고 건수를 알려 준다.
- 경고는 코드와 값으로 남기고 문구는 화면에서 만든다 (한국어·영어).
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import secrets
import tempfile
from collections import defaultdict

from sqlalchemy.orm import Session

from ..models import DailyRecord, Farm, FlockLocation, House, ImportBatch, ImportChange
from ..storage import storage
from .daily import recompute_forward

ALLOWED = [
    "bird_count", "mortality", "cull",
    "egg_jumbo", "egg_xl", "egg_l", "egg_m", "egg_s", "egg_double", "egg_mudae", "egg_muzung", "egg_crack", "egg_broken",
    "egg_weight", "body_weight", "feed_kg", "water_l", "temp_min", "temp_max", "humidity",
    "out_temp_min", "out_temp_max", "uniformity", "feed_in_kg", "feed_brand", "feed_type",
]
STR_FIELDS = {"feed_brand", "feed_type"}
INT_FIELDS = {"bird_count", "mortality", "cull"} | {f for f in ALLOWED if f.startswith("egg_") and f != "egg_weight"}
MAX_BYTES = 40 * 1024 * 1024


class ImportError_(ValueError):
    pass


def _norm(name: str) -> str:
    return re.sub(r"\s+", "", name or "")


def _clean(values: dict) -> dict:
    out = {}
    for k in ALLOWED:
        v = values.get(k)
        if v is None or v == "":
            continue
        if k in STR_FIELDS:
            out[k] = str(v)[:40]
            continue
        try:
            out[k] = int(round(float(v))) if k in INT_FIELDS else round(float(v), 2)
        except (TypeError, ValueError):
            continue
    return out


def _local_today() -> dt.date:
    from zoneinfo import ZoneInfo

    from ..settings import LOCAL_TZ

    return dt.datetime.now(ZoneInfo(LOCAL_TZ)).date()


def parse_file(importer: str, data: bytes, filename: str) -> tuple[list[dict], dict]:
    """파서를 돌려 [{house, date, values}]와 파서가 준 정보(월, 경고 등)를 돌려준다."""
    from ..importers import get_adapter

    if not filename.lower().endswith((".xlsx", ".xlsm")):
        raise ImportError_("엑셀 파일(.xlsx)만 올릴 수 있습니다. 예전 형식(.xls)은 엑셀에서 '다른 이름으로 저장 → .xlsx'로 바꿔 주세요")
    if len(data) > MAX_BYTES:
        raise ImportError_("파일이 너무 큽니다 (40MB 이하)")
    adapter = get_adapter(importer)
    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
        tmp.write(data)
        path = tmp.name
    try:
        days, rep = adapter.parse_workbook(path)
    except Exception as e:  # noqa: BLE001 — 양식이 다른 파일 등
        raise ImportError_("이 농장 양식으로 파일을 읽지 못했습니다. 다른 농장 파일이거나 양식이 바뀌었을 수 있습니다") from e
    finally:
        os.unlink(path)
    rows = [{"house": d.house, "date": d.date.isoformat(), "values": _clean(d.values)} for d in days]
    rows = [r for r in rows if r["values"]]
    info = {
        "months": sorted(getattr(rep, "months", []) or []),
        "missing_months": list(getattr(rep, "missing_months", []) or []),
        "skipped_sheets": list(getattr(rep, "skipped_sheets", []) or []),
        "duplicate_sheets": list(getattr(rep, "duplicate_sheets", []) or []),
        "title_conflicts": list(getattr(rep, "title_conflicts", []) or []),
        "lay_over_100": len(getattr(rep, "lay_over_100", []) or []),
    }
    return rows, info


def _plan(db: Session, farm: Farm, rows: list[dict], overwrite_manual: bool) -> tuple[dict, list[dict]]:
    """각 행을 new / overwrite / unchanged / skip_manual / skip_house / skip_future 로 나눈다."""
    houses = {_norm(h.name): h for h in db.query(House).filter(House.farm_id == farm.id)}
    today = _local_today()
    existing = {
        (r.house_id, r.date): r for r in db.query(DailyRecord).filter(DailyRecord.farm_id == farm.id)
    }
    per_house: dict[str, dict] = defaultdict(lambda: {"rows": 0, "new": 0, "overwrite": 0, "unchanged": 0, "skip_manual": 0, "first": None, "last": None})
    unknown: dict[str, int] = defaultdict(int)
    totals = defaultdict(int)
    plan: list[dict] = []
    no_flock = 0
    flock_of = _loc_finder(db, farm.id)
    for r in rows:
        day = dt.date.fromisoformat(r["date"])
        h = houses.get(_norm(r["house"]))
        if not h:
            unknown[r["house"]] += 1
            totals["skip_house"] += 1
            continue
        if day > today:
            totals["skip_future"] += 1
            continue
        ph = per_house[h.name]
        ph["rows"] += 1
        ph["first"] = min(ph["first"] or r["date"], r["date"])
        ph["last"] = max(ph["last"] or r["date"], r["date"])
        rec = existing.get((h.id, day))
        if rec is None:
            action = "new"
        else:
            same = all(getattr(rec, k) == v for k, v in r["values"].items())
            if same:
                action = "unchanged"
            elif rec.source == "manual" and not overwrite_manual:
                action = "skip_manual"
            else:
                action = "overwrite"
        ph[action] += 1
        totals[action] += 1
        if action in ("new", "overwrite"):
            if flock_of(h.id, day) is None:
                no_flock += 1
            plan.append({"house_id": h.id, "date": r["date"], "values": r["values"], "action": action})
    dates = [d for hh in per_house.values() for d in (hh["first"], hh["last"]) if d] or [r["date"] for r in rows]
    summary = {
        "rows": len(rows),
        "period": [min(dates), max(dates)] if dates else None,
        "totals": {k: totals.get(k, 0) for k in ("new", "overwrite", "unchanged", "skip_manual", "skip_house", "skip_future")},
        "houses": [{"house": k, **v} for k, v in sorted(per_house.items(), key=lambda kv: (_house_key(kv[0])))],
        "unknown_houses": [{"house": k, "rows": v} for k, v in sorted(unknown.items())],
        "no_flock": no_flock,
    }
    return summary, plan


def _loc_finder(db: Session, farm_id: int):
    """계사·날짜 → 계군 id. 행마다 DB를 묻지 않도록 위치 기록을 한 번에 읽어 둔다."""
    by_house: dict[int, list[FlockLocation]] = defaultdict(list)
    for loc in (
        db.query(FlockLocation)
        .join(House, House.id == FlockLocation.house_id)
        .filter(House.farm_id == farm_id)
        .order_by(FlockLocation.from_date.desc())
    ):
        by_house[loc.house_id].append(loc)

    def find(house_id: int, day: dt.date) -> int | None:
        for loc in by_house.get(house_id, []):
            if loc.from_date <= day and (loc.to_date is None or loc.to_date >= day):
                return loc.flock_id
        return None

    return find


def _house_key(name: str):
    m = re.match(r"(\d+)", name)
    return (0, int(m.group(1)), name) if m else (1, 0, name)


def _warnings(info: dict, summary: dict) -> list[dict]:
    w = []
    if summary["unknown_houses"]:
        w.append({"code": "unknown_houses", "houses": ", ".join(u["house"] for u in summary["unknown_houses"]), "rows": sum(u["rows"] for u in summary["unknown_houses"])})
    if summary["totals"]["skip_manual"]:
        w.append({"code": "skip_manual", "n": summary["totals"]["skip_manual"]})
    if summary["no_flock"]:
        w.append({"code": "no_flock", "n": summary["no_flock"]})
    if summary["totals"]["skip_future"]:
        w.append({"code": "future", "n": summary["totals"]["skip_future"]})
    if info.get("missing_months"):
        w.append({"code": "missing_months", "months": ", ".join(info["missing_months"])})
    if info.get("skipped_sheets"):
        w.append({"code": "skipped_sheets", "sheets": ", ".join(info["skipped_sheets"])})
    if info.get("duplicate_sheets"):
        w.append({"code": "duplicate_sheets", "sheets": ", ".join(info["duplicate_sheets"])})
    if info.get("lay_over_100"):
        w.append({"code": "lay_over_100", "n": info["lay_over_100"]})
    return w


def create_preview(db: Session, farm: Farm, data: bytes, filename: str, user_id: int, overwrite_manual: bool) -> ImportBatch:
    if not farm.importer:
        raise ImportError_("이 농장은 아직 엑셀 양식이 등록되지 않았습니다. 반석에 엑셀 파일을 보내 주시면 등록해 드립니다")
    rows, info = parse_file(farm.importer, data, filename)
    if not rows:
        raise ImportError_("파일에서 읽을 수 있는 기록이 없습니다")
    stem = f"imports/{farm.id}/{dt.date.today():%Y%m}/{secrets.token_hex(8)}"
    storage.put(f"{stem}.xlsx", data)
    storage.put(f"{stem}.json", json.dumps(rows, ensure_ascii=False).encode())
    summary, _ = _plan(db, farm, rows, overwrite_manual)
    summary["months"] = info["months"]
    summary["warnings"] = _warnings(info, summary)
    b = ImportBatch(
        farm_id=farm.id,
        importer=farm.importer,
        filename=os.path.basename(filename)[:255],
        file_key=f"{stem}.xlsx",
        rows_key=f"{stem}.json",
        status="preview",
        overwrite_manual=overwrite_manual,
        summary=summary,
        uploaded_by=user_id,
    )
    db.add(b)
    db.commit()
    return b


def apply(db: Session, b: ImportBatch, user_id: int) -> ImportBatch:
    if b.status != "preview":
        raise ImportError_("이미 처리한 업로드입니다")
    farm = db.get(Farm, b.farm_id)
    rows = json.loads(storage.get(b.rows_key))
    summary, plan = _plan(db, farm, rows, b.overwrite_manual)  # 미리보기 뒤 바뀐 것이 있을 수 있어 다시 계산
    earliest: dict[int, dt.date] = {}
    existing = {(r.house_id, r.date): r for r in db.query(DailyRecord).filter(DailyRecord.farm_id == farm.id)}
    flock_of = _loc_finder(db, farm.id)
    created: list[tuple[DailyRecord, None]] = []
    changes: list[ImportChange] = []
    for p in plan:
        day = dt.date.fromisoformat(p["date"])
        rec = existing.get((p["house_id"], day))
        if rec is None:
            rec = DailyRecord(farm_id=farm.id, house_id=p["house_id"], date=day)
            db.add(rec)
            before = None
            action = "created"
        else:
            before = {k: getattr(rec, k) for k in list(p["values"]) + ["bird_count", "bird_count_manual", "source", "entered_by"]}
            action = "updated"
        for k, v in p["values"].items():
            setattr(rec, k, v)
        if "bird_count" in p["values"]:
            rec.bird_count_manual = True
        rec.flock_id = flock_of(p["house_id"], day)
        rec.source, rec.entered_by = "upload", user_id
        created.append((rec, None))
        changes.append(ImportChange(batch_id=b.id, record_id=0, action=action, before=before))
        earliest[p["house_id"]] = min(earliest.get(p["house_id"], day), day)
    db.flush()  # 한 번에 저장해 id를 받는다
    for (rec, _), ch in zip(created, changes):
        ch.record_id = rec.id
    db.add_all(changes)
    db.flush()
    for hid, day in earliest.items():
        recompute_forward(db, hid, day - dt.timedelta(days=1))
    b.status = "applied"
    b.applied_at = dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)
    b.summary = {**b.summary, "applied": {"new": summary["totals"]["new"], "overwrite": summary["totals"]["overwrite"]}}
    db.commit()
    return b


def revert(db: Session, b: ImportBatch, user_id: int) -> ImportBatch:
    if b.status != "applied":
        raise ImportError_("반영한 업로드만 되돌릴 수 있습니다")
    changes = db.query(ImportChange).filter(ImportChange.batch_id == b.id).all()
    kept = 0
    earliest: dict[int, dt.date] = {}
    for c in changes:
        rec = db.get(DailyRecord, c.record_id)
        if rec is None:
            continue
        # 반영 뒤 다른 사람이 고친 날은 그대로 둔다
        if rec.source != "upload" or rec.updated_at and b.applied_at and rec.updated_at > b.applied_at + dt.timedelta(seconds=5):
            kept += 1
            continue
        earliest[rec.house_id] = min(earliest.get(rec.house_id, rec.date), rec.date)
        if c.action == "created":
            db.delete(rec)
        else:
            for k, v in (c.before or {}).items():
                setattr(rec, k, v)
    db.flush()
    for hid, day in earliest.items():
        recompute_forward(db, hid, day - dt.timedelta(days=1))
    b.status = "reverted"
    b.reverted_at = dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)
    b.reverted_by = user_id
    b.summary = {**b.summary, "reverted": {"restored": len(changes) - kept, "kept": kept}}
    db.commit()
    return b
