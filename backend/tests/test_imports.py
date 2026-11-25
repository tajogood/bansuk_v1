"""농장주 엑셀 업로드: 미리보기 → 반영 → 되돌리기, 직접 입력과 겹칠 때 규칙."""
import datetime as dt
import io
import os

os.environ["DATABASE_URL"] = "sqlite:///./test_bansuk.db"

import openpyxl  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import DailyRecord, Farm, FarmInputConfig, House, UserFarm  # noqa: E402
from tests.helpers import make_user  # noqa: E402
from tests.test_import_sayang import _sheet  # noqa: E402


def workbook_bytes() -> bytes:
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    _sheet(wb, "25.10", 2025, 10, 300, lambda a: f"{a // 7}-{a}")
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


@pytest.fixture()
def client():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    db = SessionLocal()
    farm = Farm(name="업로드농장", importer="sayang_monthly")
    bare = Farm(name="양식없는농장")
    db.add_all([farm, bare])
    db.flush()
    db.add(FarmInputConfig(farm_id=farm.id))
    h1 = House(farm_id=farm.id, name="1동", sort_order=1)  # 엑셀의 "2동"은 일부러 없음
    db.add(h1)
    owner, other = make_user("농장주", "01000000000", "farm_owner"), make_user("남", "01099990000", "farm_owner")
    admin = make_user("관리자", "01022222222", "admin")
    db.add_all([owner, other, admin])
    db.flush()
    db.add_all([UserFarm(user_id=owner.id, farm_id=farm.id), UserFarm(user_id=owner.id, farm_id=bare.id), UserFarm(user_id=other.id, farm_id=bare.id)])
    db.commit()
    ids = {"farm": farm.id, "bare": bare.id, "h1": h1.id}
    db.close()
    with TestClient(app) as c:
        c.ids = ids
        yield c


def H(c, phone="01000000000"):
    return {"Authorization": "Bearer " + c.post("/api/auth/login", json={"phone": phone, "pin": "1234"}).json()["token"]}


def up(c, h, farm, overwrite=False, data=None, name="사양관리.xlsx"):
    return c.post(f"/api/farms/{farm}/imports", headers=h, files={"file": (name, data or workbook_bytes(), "application/octet-stream")}, data={"overwrite_manual": "true" if overwrite else "false"})


def test_preview_apply_revert(client):
    h = H(client)
    fid = client.ids["farm"]
    # 직접 입력한 날 하나 (10월 5일)
    client.put(f"/api/farms/{fid}/houses/{client.ids['h1']}/daily/2025-10-05", headers=h, json={"mortality": 99})
    r = up(client, h, fid)
    assert r.status_code == 200, r.text
    b = r.json()
    s = b["summary"]
    assert b["status"] == "preview"
    assert s["period"] == ["2025-10-01", "2025-10-30"]
    assert s["totals"]["new"] == 29 and s["totals"]["skip_manual"] == 1 and s["totals"]["skip_house"] == 30
    codes = {w["code"] for w in s["warnings"]}
    assert {"unknown_houses", "skip_manual", "no_flock"} <= codes
    # 미리보기만으로는 아무것도 안 들어감
    with SessionLocal() as db:
        assert db.query(DailyRecord).count() == 1
    r = client.post(f"/api/imports/{b['id']}/apply", headers=h)
    assert r.json()["status"] == "applied"
    with SessionLocal() as db:
        recs = {r.date: r for r in db.query(DailyRecord).all()}
        assert len(recs) == 30
        assert recs[dt.date(2025, 10, 5)].mortality == 99  # 직접 입력 우선
        r10 = recs[dt.date(2025, 10, 10)]
        assert r10.egg_xl == 3000 and r10.egg_l == 6000 and r10.feed_kg == 1200 and r10.source == "upload"
        assert r10.temp_min == 20.1 and r10.temp_max == 25.3
    # 같은 파일 다시: 모두 그대로
    s2 = up(client, h, fid).json()["summary"]["totals"]
    assert s2["new"] == 0 and s2["unchanged"] == 29
    # 되돌리기 → 업로드로 만든 기록만 사라짐
    r = client.post(f"/api/imports/{b['id']}/revert", headers=h)
    assert r.json()["status"] == "reverted" and r.json()["summary"]["reverted"]["restored"] == 29
    with SessionLocal() as db:
        assert db.query(DailyRecord).count() == 1
    hist = client.get(f"/api/farms/{fid}/imports", headers=h).json()
    assert hist["importer"]["code"] == "sayang_monthly" and len(hist["batches"]) == 2


def test_overwrite_manual_when_asked(client):
    h = H(client)
    fid = client.ids["farm"]
    client.put(f"/api/farms/{fid}/houses/{client.ids['h1']}/daily/2025-10-05", headers=h, json={"mortality": 99})
    b = up(client, h, fid, overwrite=True).json()
    assert b["summary"]["totals"]["overwrite"] == 1
    client.post(f"/api/imports/{b['id']}/apply", headers=h)
    with SessionLocal() as db:
        assert db.query(DailyRecord).filter_by(date=dt.date(2025, 10, 5)).one().mortality == 2
    # 되돌리면 직접 입력 값으로 복원
    client.post(f"/api/imports/{b['id']}/revert", headers=h)
    with SessionLocal() as db:
        rec = db.query(DailyRecord).filter_by(date=dt.date(2025, 10, 5)).one()
        assert rec.mortality == 99 and rec.source == "manual"


def test_errors_and_permissions(client):
    h = H(client)
    assert up(client, h, client.ids["bare"]).status_code == 400  # 양식 미등록
    assert up(client, h, client.ids["farm"], name="old.xls").status_code == 400
    assert up(client, h, client.ids["farm"], data=b"not excel").status_code == 400
    assert up(client, H(client, "01099990000"), client.ids["farm"]).status_code == 403
    # 관리자가 농장에 양식 지정
    a = H(client, "01022222222")
    farms = client.get("/api/admin/farms", headers=a).json()
    assert "sayang_monthly" in farms["importers"]
    bare = next(f for f in farms["farms"] if f["id"] == client.ids["bare"])
    body = {"name": bare["name"], "region": None, "contract_type": "program", "active": True, "importer": "sayang_monthly", "houses": [], "config": None}
    assert client.put(f"/api/admin/farms/{bare['id']}", headers=a, json=body).status_code == 200
    assert up(client, h, client.ids["bare"]).status_code == 200
    body["importer"] = "nope"
    assert client.put(f"/api/admin/farms/{bare['id']}", headers=a, json=body).status_code == 400
