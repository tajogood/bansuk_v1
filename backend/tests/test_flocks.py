import datetime as dt
import os

os.environ["DATABASE_URL"] = "sqlite:///./test_bansuk.db"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Farm, FarmInputConfig, House, UserFarm  # noqa: E402
from tests.helpers import make_user  # noqa: E402

D = dt.date.today()


def iso(days_ago: int) -> str:
    return (D - dt.timedelta(days=days_ago)).isoformat()


@pytest.fixture()
def client():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    db = SessionLocal()
    farm, other = Farm(name="새농장"), Farm(name="남의농장")
    db.add_all([farm, other])
    db.flush()
    db.add(FarmInputConfig(farm_id=farm.id))
    rear = House(farm_id=farm.id, name="육성사", kind="rearing", sort_order=0)
    lay1 = House(farm_id=farm.id, name="1동", kind="laying", sort_order=1)
    lay2 = House(farm_id=farm.id, name="2동", kind="laying", sort_order=2)
    db.add_all([rear, lay1, lay2])
    owner, stranger, vet = make_user("농장주", "01000000000", "farm_owner"), make_user("남", "01099990000", "farm_owner"), make_user("수의", "01011111111", "bansuk_vet")
    db.add_all([owner, stranger, vet])
    db.flush()
    db.add_all([UserFarm(user_id=owner.id, farm_id=farm.id), UserFarm(user_id=stranger.id, farm_id=other.id)])
    db.commit()
    ids = {"farm": farm.id, "rear": rear.id, "lay1": lay1.id, "lay2": lay2.id}
    db.close()
    with TestClient(app) as c:
        c.ids = ids
        yield c


def H(c, phone):
    return {"Authorization": "Bearer " + c.post("/api/auth/login", json={"phone": phone, "pin": "1234"}).json()["token"]}


def daily(c, h, house, day, **v):
    r = c.put(f"/api/farms/{c.ids['farm']}/houses/{house}/daily/{day}", headers=h, json=v)
    assert r.status_code == 200, r.text
    return r.json()


def test_new_farm_place_move_close(client):
    h = H(client, "01000000000")
    fid = client.ids["farm"]
    # 새 농장: 계군 없음
    board = client.get(f"/api/farms/{fid}/flock-board", headers=h).json()
    assert all(x["flock"] is None for x in board["houses"])
    # 육성사에 입추 (120일 전)
    r = client.post(f"/api/farms/{fid}/flocks", headers=h, json={"house_id": client.ids["rear"], "placed_on": iso(120), "placed_count": 50000, "breed": "갈색", "hatchery": "가나부화장"})
    assert r.status_code == 200, r.text
    flock = r.json()["flock"]
    assert flock["status"] == "rearing" and flock["age_days"] == 121
    # 같은 계사 겹치는 입추는 거부
    r = client.post(f"/api/farms/{fid}/flocks", headers=h, json={"house_id": client.ids["rear"], "placed_on": iso(10), "placed_count": 100})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "house_busy"
    # 일일 입력이 계군·일령을 안다
    day = client.get(f"/api/farms/{fid}/day?date={iso(0)}", headers=h).json()
    rear_view = next(x for x in day["houses"] if x["house"]["id"] == client.ids["rear"])
    assert rear_view["flock"]["age_days"] == 121 and rear_view["expected_start_count"] == 50000
    daily(client, h, client.ids["rear"], iso(5), mortality=20)
    # 산란사로 이동 (3일 전, 전입 수수 입력 안 함 → 마지막 수수)
    r = client.post(f"/api/flocks/{flock['id']}/move", headers=h, json={"to_house_id": client.ids["lay1"], "date": iso(3)})
    assert r.status_code == 200, r.text
    moved = r.json()["flock"]
    assert moved["status"] == "laying" and moved["current_house"]["id"] == client.ids["lay1"]
    assert moved["locations"][-1]["start_count"] == 49980 and moved["locations"][0]["to"] == iso(4)
    rec = daily(client, h, client.ids["lay1"], iso(1), mortality=5, egg_l=30000)
    assert rec["record"]["bird_count"] == 49975
    # 출하로 종료 → 계사가 비어 다음 입추 가능
    r = client.post(f"/api/flocks/{flock['id']}/close", headers=h, json={"date": iso(0), "reason": "shipped"})
    assert r.json()["flock"]["status"] == "closed"
    board = client.get(f"/api/farms/{fid}/flock-board", headers=h).json()
    assert len(board["closed"]) == 1 and not board["active"]
    assert client.post(f"/api/farms/{fid}/flocks", headers=h, json={"house_id": client.ids["lay1"], "placed_on": (D + dt.timedelta(days=1)).isoformat(), "placed_count": 40000}).status_code == 200
    # 되돌리기: 종료 뒤 다른 계군이 들어와서 안 됨
    assert client.post(f"/api/flocks/{flock['id']}/undo", headers=h).status_code == 409


def test_records_entered_before_placement_get_linked(client):
    h = H(client, "01000000000")
    fid = client.ids["farm"]
    daily(client, h, client.ids["lay2"], iso(3), mortality=2, egg_l=900)
    daily(client, h, client.ids["lay2"], iso(2), mortality=1, egg_l=950)
    assert client.get(f"/api/farms/{fid}/flock-board", headers=h).json()["unlinked_records"] == 2
    r = client.post(f"/api/farms/{fid}/flocks", headers=h, json={"house_id": client.ids["lay2"], "placed_on": iso(200), "placed_count": 1000})
    assert r.json()["linked_records"] == 2
    day = client.get(f"/api/farms/{fid}/daily?start={iso(3)}&end={iso(2)}", headers=h).json()
    counts = [x["bird_count"] for x in day["records"]]
    assert counts == [998, 997]
    # 입추일을 고치면 기록은 다시 계산
    fl = r.json()["flock"]
    r = client.patch(f"/api/flocks/{fl['id']}", headers=h, json={"placed_count": 2000})
    day = client.get(f"/api/farms/{fid}/daily?start={iso(3)}&end={iso(2)}", headers=h).json()
    assert [x["bird_count"] for x in day["records"]] == [1998, 1997]


def test_undo_move_and_permissions(client):
    h, s, v = H(client, "01000000000"), H(client, "01099990000"), H(client, "01011111111")
    fid = client.ids["farm"]
    fl = client.post(f"/api/farms/{fid}/flocks", headers=v, json={"house_id": client.ids["rear"], "placed_on": iso(100), "placed_count": 3000}).json()["flock"]
    client.post(f"/api/flocks/{fl['id']}/move", headers=h, json={"to_house_id": client.ids["lay2"], "date": iso(2), "count": 2900})
    r = client.post(f"/api/flocks/{fl['id']}/undo", headers=h)
    assert r.json()["flock"]["current_house"]["id"] == client.ids["rear"] and r.json()["flock"]["status"] == "rearing"
    assert client.get(f"/api/farms/{fid}/flock-board", headers=s).status_code == 403
    assert client.post(f"/api/flocks/{fl['id']}/close", headers=s, json={"date": iso(0)}).status_code == 403
    assert client.delete(f"/api/flocks/{fl['id']}", headers=h).status_code == 200
    assert client.get(f"/api/farms/{fid}/flock-board", headers=h).json()["active"] == []
