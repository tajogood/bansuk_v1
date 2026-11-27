"""데모농장 생산 기록을 실제 사양관리현황 엑셀로 다시 채운다.

    python -m app.demo_excel 파일.xlsx [--farm 데모농장]

- 데모농장의 일일 기록·계군을 지우고 엑셀에서 다시 만든다 (계사는 이름으로 맞추고 없으면 만든다).
- 부검 건·접종·검사·보고서 등이 가리키던 예전 계군은 같은 계사의 새 현재 계군으로 옮긴다.
- 다른 농장과 계정은 건드리지 않는다.
"""
from __future__ import annotations

import argparse
import datetime as dt

from .db import SessionLocal
from .importers import sayang
from .models import (DailyRecord, Farm, FarmInputConfig, Flock, FlockLocation, FlockProgram, House, ImportBatch,
                     ImportChange, IssuedReport, LabSubmission, NecropsyCase, PlannedVaccination, Vaccination)

REFS = [NecropsyCase, Vaccination, PlannedVaccination, FlockProgram, LabSubmission, IssuedReport]


def rebuild(path: str, farm_name: str = "데모농장") -> str:
    days, rep = sayang.parse_workbook(path)
    db = SessionLocal()
    farm = db.query(Farm).filter_by(name=farm_name).one_or_none()
    if farm is None:
        farm = Farm(name=farm_name, region="충북", contract_type="program", importer="sayang_monthly")
        db.add(farm)
        db.flush()
    if farm.config is None:
        db.add(FarmInputConfig(farm_id=farm.id))
    farm.importer = "sayang_monthly"
    cfg = farm.config or db.get(FarmInputConfig, farm.id)
    if cfg is not None:
        cfg.grades = ["jumbo", "xl", "l", "m", "s", "double", "mudae", "broken"]
        cfg.show_egg_weight = True

    # 예전 계군이 어느 계사에 있었는지 (참조를 옮기려고)
    old_flocks = db.query(Flock).filter_by(farm_id=farm.id).all()
    old_house: dict[int, int] = {}
    for loc in db.query(FlockLocation).filter(FlockLocation.flock_id.in_([f.id for f in old_flocks] or [0])).order_by(FlockLocation.from_date):
        old_house[loc.flock_id] = loc.house_id

    db.query(DailyRecord).filter_by(farm_id=farm.id).delete(synchronize_session=False)
    batch_ids = [b.id for b in db.query(ImportBatch.id).filter_by(farm_id=farm.id)]
    if batch_ids:
        db.query(ImportChange).filter(ImportChange.batch_id.in_(batch_ids)).delete(synchronize_session=False)
        db.query(ImportBatch).filter(ImportBatch.id.in_(batch_ids)).delete(synchronize_session=False)
    if old_flocks:
        db.query(FlockLocation).filter(FlockLocation.flock_id.in_([f.id for f in old_flocks])).delete(synchronize_session=False)
    db.commit()

    # 새 계군·기록 (이관 도구와 같은 규칙)
    sayang.to_db(days, rep, farm_name)

    db.expire_all()
    houses = {h.id: h for h in db.query(House).filter_by(farm_id=farm.id)}
    today = dt.date.today()
    new_current: dict[int, int] = {}
    for loc in db.query(FlockLocation).join(House, House.id == FlockLocation.house_id).filter(House.farm_id == farm.id).order_by(FlockLocation.from_date):
        if loc.flock_id in {f.id for f in old_flocks}:
            continue
        if loc.to_date is None or loc.to_date >= today - dt.timedelta(days=7):
            new_current[loc.house_id] = loc.flock_id

    moved = 0
    for f in old_flocks:
        target = new_current.get(old_house.get(f.id, -1))
        for M in REFS:
            q = db.query(M).filter(M.flock_id == f.id)
            n = q.count()
            if n and target:
                q.update({M.flock_id: target}, synchronize_session=False)
                moved += n
            elif n and M.__table__.c.flock_id.nullable:
                q.update({M.flock_id: None}, synchronize_session=False)
            elif n:
                q.delete(synchronize_session=False)
    db.flush()
    for f in old_flocks:
        db.delete(f)
    # 엑셀에 없는 계사(예전 데모용)는 기록이 없으면 비활성
    for h in houses.values():
        h.active = db.query(DailyRecord.id).filter_by(house_id=h.id).first() is not None
    db.commit()
    n = db.query(DailyRecord).filter_by(farm_id=farm.id).count()
    return f"{farm_name}: 일일 기록 {n}건, 계군 {len(rep.flocks)}구간, 옮긴 참조 {moved}건"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("xlsx")
    ap.add_argument("--farm", default="데모농장")
    a = ap.parse_args()
    print(rebuild(a.xlsx, a.farm))


if __name__ == "__main__":
    main()
