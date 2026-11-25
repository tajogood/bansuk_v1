import datetime as dt
import os

os.environ["DATABASE_URL"] = "sqlite:///./test_bansuk.db"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import DailyRecord, Farm, Flock, FlockLocation, House, User, UserFarm  # noqa: E402
from app.security import hash_pin  # noqa: E402

TODAY = dt.date.today()


def _flock(db, farm, house, placed, days, lay, program=None):
    f = Flock(farm_id=farm.id, placed_on=placed, placed_count=10000, program_name=program)
    db.add(f)
    db.flush()
    db.add(FlockLocation(flock_id=f.id, house_id=house.id, from_date=placed, start_count=10000))
    n = 10000
    for i in range(days):
        day = placed + dt.timedelta(days=140 + i)  # 140일령부터 기록
        n -= 1
        rate = lay(140 + i + 1)
        eggs = int(n * rate / 30) * 30
        db.add(DailyRecord(farm_id=farm.id, house_id=house.id, flock_id=f.id, date=day, bird_count=n,
                           mortality=1, egg_l=eggs, feed_kg=round(n * 0.115, 1), egg_weight=57.0, water_l=2000))
    return f


@pytest.fixture()
def client():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    db = SessionLocal()
    farm = Farm(name="보고서농장")
    db.add(farm)
    db.flush()
    h = House(farm_id=farm.id, name="1동")
    db.add(h)
    db.flush()
    base = TODAY - dt.timedelta(days=2000)
    for k, lvl in enumerate([0.80, 0.83, 0.85, 0.86]):
        _flock(db, farm, h, base + dt.timedelta(days=400 * k), 60, lambda a, lvl=lvl: lvl)
    target = _flock(db, farm, h, TODAY - dt.timedelta(days=210), 60, lambda a: 0.92, program="반석 프로그램")
    owner = User(name="농장주", phone="01000000000", pin_hash=hash_pin("1234"), role="farm_owner")
    vet = User(name="수의사", phone="01011111111", pin_hash=hash_pin("1234"), role="bansuk_vet")
    db.add_all([owner, vet])
    db.flush()
    db.add(UserFarm(user_id=owner.id, farm_id=farm.id))
    db.commit()
    ids = {"farm": farm.id, "target": target.id}
    db.close()
    with TestClient(app) as c:
        c.ids = ids
        yield c


def auth(c, phone):
    t = c.post("/api/auth/login", json={"phone": phone, "pin": "1234"}).json()["token"]
    return {"Authorization": f"Bearer {t}"}


def test_preview_compares_with_past_flocks_at_same_age(client):
    h = auth(client, "01011111111")
    r = client.get(f"/api/reports/flocks/{client.ids['target']}", headers=h, params={"age_from": 150, "age_to": 190})
    assert r.status_code == 200, r.text
    rep = r.json()
    c = rep["comparison"]
    assert c["peer_count"] == 4
    lay = next(m for m in c["metrics"] if m["metric"] == "lay_rate")
    assert lay["rank"] == 1 and lay["of"] == 5
    assert 91 < lay["target"] < 93
    assert rep["flock"]["program"] == "반석 프로그램"
    assert len(rep["data"]["fingerprint"]) == 16
    banded = [b for b in rep["band"] if "median" in b]
    assert banded and banded[0]["n"] == 4


def test_issue_requires_bansuk_and_freezes_result(client):
    owner = auth(client, "01000000000")
    fid = client.ids["target"]
    assert client.post(f"/api/reports/flocks/{fid}/issue", headers=owner, json={}).status_code == 403

    vet = auth(client, "01011111111")
    r = client.post(f"/api/reports/flocks/{fid}/issue", headers=vet, json={"reviewer_note": "검토 완료"})
    assert r.status_code == 200
    no = r.json()["meta"]["report_no"]
    assert no.startswith(f"BS{TODAY:%y}-RPT-")

    got = client.get(f"/api/reports/issued/{no}", headers=owner).json()  # 농장주도 자기 농장 발행본은 열람
    assert got["meta"]["data_changed_since_issue"] is False

    # 발행 후 원자료가 바뀌면 표시된다 (발행본 내용은 그대로)
    db = SessionLocal()
    rec = db.query(DailyRecord).filter_by(flock_id=fid).first()
    rec.egg_l = (rec.egg_l or 0) + 300
    db.commit()
    db.close()
    got2 = client.get(f"/api/reports/issued/{no}", headers=vet).json()
    assert got2["meta"]["data_changed_since_issue"] is True
    assert got2["comparison"] == got["comparison"]


def test_csv_and_dashboard(client):
    h = auth(client, "01000000000")
    r = client.get(f"/api/reports/flocks/{client.ids['target']}/data.csv", headers=h)
    assert r.status_code == 200
    lines = r.text.lstrip("﻿").splitlines()
    assert lines[0].startswith("date,age_days,house")
    assert len(lines) == 61
    d = client.get(f"/api/farms/{client.ids['farm']}/dashboard", headers=h).json()
    assert d["houses"][0]["house"]["name"] == "1동"
