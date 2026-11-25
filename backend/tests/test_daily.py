import datetime as dt
import os

os.environ["DATABASE_URL"] = "sqlite:///./test_bansuk.db"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Farm, Flock, FlockLocation, House, User, UserFarm  # noqa: E402
from tests.helpers import make_user  # noqa: E402

TODAY = dt.date.today()


@pytest.fixture()
def client():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    db = SessionLocal()
    farm = Farm(name="테스트농장")
    other = Farm(name="남의농장")
    db.add_all([farm, other])
    db.flush()
    h1 = House(farm_id=farm.id, name="1동", sort_order=1)
    h2 = House(farm_id=farm.id, name="2동", sort_order=2)
    db.add_all([h1, h2])
    db.flush()
    fl = Flock(farm_id=farm.id, placed_on=TODAY - dt.timedelta(days=199), placed_count=10500)
    db.add(fl)
    db.flush()
    db.add(FlockLocation(flock_id=fl.id, house_id=h1.id, from_date=TODAY - dt.timedelta(days=120), start_count=10000))
    owner = make_user("농장주", "01000000000", "farm_owner")
    vet = make_user("수의사", "01011111111", "bansuk_vet")
    db.add_all([owner, vet])
    db.flush()
    db.add(UserFarm(user_id=owner.id, farm_id=farm.id))
    db.commit()
    ids = {"farm": farm.id, "other": other.id, "h1": h1.id, "h2": h2.id}
    db.close()
    with TestClient(app) as c:
        c.ids = ids
        yield c


def login(c, phone="010-0000-0000"):
    r = c.post("/api/auth/login", json={"phone": phone, "pin": "1234"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_login_wrong_pin(client):
    r = client.post("/api/auth/login", json={"phone": "01000000000", "pin": "9999"})
    assert r.status_code == 401


def test_owner_cannot_see_other_farm(client):
    h = login(client)
    r = client.get(f"/api/farms/{client.ids['other']}/day", headers=h)
    assert r.status_code == 403
    assert [f["name"] for f in client.get("/api/me", headers=h).json()["farms"]] == ["테스트농장"]


def test_vet_sees_all_farms(client):
    h = login(client, "01011111111")
    assert len(client.get("/api/me", headers=h).json()["farms"]) == 2


def test_day_view_shows_flock_age_and_progress(client):
    h = login(client)
    r = client.get(f"/api/farms/{client.ids['farm']}/day", params={"date": TODAY.isoformat()}, headers=h)
    body = r.json()
    assert body["progress"] == {"done": 0, "total": 2}
    first = body["houses"][0]
    assert first["flock"]["age_days"] == 200  # 입추일 = 1일령 (기본 설정)
    assert first["flock"]["age_weeks"] == 28
    assert first["expected_start_count"] == 10000
    assert body["houses"][1]["flock"] is None
    assert [g["code"] for g in body["config"]["grades"]][:3] == ["jumbo", "xl", "l"]


def test_save_computes_bird_count_and_lay_rate(client):
    h = login(client)
    f, h1 = client.ids["farm"], client.ids["h1"]
    d1 = (TODAY - dt.timedelta(days=1)).isoformat()
    r = client.put(
        f"/api/farms/{f}/houses/{h1}/daily/{d1}",
        json={"mortality": 10, "egg_xl": 3000, "egg_l": 5700, "feed_kg": 1180},
        headers=h,
    )
    assert r.status_code == 200, r.text
    rec = r.json()["record"]
    assert rec["bird_count"] == 9990
    assert rec["metrics"]["total_eggs"] == 8700
    assert rec["metrics"]["lay_rate"] == 87.1
    assert rec["metrics"]["feed_per_bird_g"] == 118.1

    # 다음 날은 전일 수수에서 이어서 계산
    r2 = client.put(f"/api/farms/{f}/houses/{h1}/daily/{TODAY.isoformat()}", json={"mortality": 5}, headers=h)
    assert r2.json()["record"]["bird_count"] == 9985
    assert r2.json()["previous"]["date"] == d1

    # 전날 폐사를 고치면 오늘 수수도 다시 계산
    client.put(f"/api/farms/{f}/houses/{h1}/daily/{d1}", json={"mortality": 20}, headers=h)
    day = client.get(f"/api/farms/{f}/day", params={"date": TODAY.isoformat()}, headers=h).json()
    assert day["houses"][0]["record"]["bird_count"] == 9975
    assert day["progress"]["done"] == 1


def test_manual_bird_count_is_kept(client):
    h = login(client)
    f, h1 = client.ids["farm"], client.ids["h1"]
    d1 = (TODAY - dt.timedelta(days=1)).isoformat()
    client.put(f"/api/farms/{f}/houses/{h1}/daily/{d1}", json={"bird_count": 9800, "mortality": 3}, headers=h)
    r = client.put(f"/api/farms/{f}/houses/{h1}/daily/{TODAY.isoformat()}", json={"mortality": 2}, headers=h)
    assert r.json()["record"]["bird_count"] == 9798


def test_lay_over_100_warning(client):
    h = login(client)
    f, h1 = client.ids["farm"], client.ids["h1"]
    r = client.put(
        f"/api/farms/{f}/houses/{h1}/daily/{TODAY.isoformat()}",
        json={"mortality": 0, "egg_l": 12000},
        headers=h,
    )
    codes = [w["code"] for w in r.json()["warnings"]]
    assert "lay_over_100" in codes


def test_mortality_spike_warning(client):
    h = login(client)
    f, h1 = client.ids["farm"], client.ids["h1"]
    for back in range(8, 0, -1):
        d = (TODAY - dt.timedelta(days=back)).isoformat()
        client.put(f"/api/farms/{f}/houses/{h1}/daily/{d}", json={"mortality": 2, "egg_l": 9000}, headers=h)
    r = client.put(f"/api/farms/{f}/houses/{h1}/daily/{TODAY.isoformat()}", json={"mortality": 12, "egg_l": 9000}, headers=h)
    assert "mortality_spike" in [w["code"] for w in r.json()["warnings"]]


def test_future_date_rejected(client):
    h = login(client)
    d = (TODAY + dt.timedelta(days=5)).isoformat()
    r = client.put(f"/api/farms/{client.ids['farm']}/houses/{client.ids['h1']}/daily/{d}", json={"mortality": 1}, headers=h)
    assert r.status_code == 400
