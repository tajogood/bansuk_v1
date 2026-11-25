import datetime as dt
import os

os.environ["DATABASE_URL"] = "sqlite:///./test_bansuk.db"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Farm, Flock, FlockLocation, House, UserFarm  # noqa: E402
from tests.helpers import make_user  # noqa: E402

T = dt.date.today()


@pytest.fixture()
def client():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    db = SessionLocal()
    farm = Farm(name="백신농장")
    db.add(farm)
    db.flush()
    h = House(farm_id=farm.id, name="1동")
    db.add(h)
    db.flush()
    fl = Flock(farm_id=farm.id, placed_on=T - dt.timedelta(days=50), placed_count=20000)  # 51일령
    db.add(fl)
    db.flush()
    db.add(FlockLocation(flock_id=fl.id, house_id=h.id, from_date=fl.placed_on, start_count=20000))
    owner, vet = make_user("농장주", "01000000000", "farm_owner"), make_user("수의", "01011111111", "bansuk_vet")
    db.add_all([owner, vet])
    db.flush()
    db.add(UserFarm(user_id=owner.id, farm_id=farm.id))
    db.commit()
    ids = {"flock": fl.id, "farm": farm.id}
    db.close()
    with TestClient(app) as c:
        c.ids = ids
        yield c


def H(c, phone):
    return {"Authorization": "Bearer " + c.post("/api/auth/login", json={"phone": phone, "pin": "1234"}).json()["token"]}


def make_program(c, v):
    nd = c.post("/api/vaccines", headers=v, json={"name": "ND+IB 생독", "kind": "live", "route": "spray", "components": [{"disease": "nd", "strain": "La Sota"}, {"disease": "ib", "strain": "H120"}]}).json()
    kill = c.post("/api/vaccines", headers=v, json={"name": "ND+IB+EDS+AI 사독", "kind": "inactivated", "route": "injection_im", "components": [{"disease": "nd"}, {"disease": "ib"}, {"disease": "eds"}, {"disease": "lpai", "strain": "H9N2"}]}).json()
    p = c.post("/api/programs", headers=v, json={"name": "반석 산란계", "items": [
        {"age_days": 7, "vaccine_id": nd["id"]},
        {"age_days": 49, "vaccine_id": nd["id"], "note": "부스터"},
        {"age_days": 56, "vaccine_id": nd["id"]},
        {"age_days": 112, "vaccine_id": kill["id"]},
    ]}).json()
    return nd, kill, p


def test_program_assign_schedule_and_vaccination(client):
    v, f = H(client, "01011111111"), H(client, "01000000000")
    nd, kill, p = make_program(client, v)
    assert p["label"] == "반석 산란계 v1" and p["item_count"] == 4
    fid = client.ids["flock"]
    r = client.post(f"/api/flocks/{fid}/program", headers=v, json={"program_id": p["id"], "from_date": (T - dt.timedelta(days=50)).isoformat()})
    assert r.status_code == 200, r.text
    sched = {s["age_days"]: s for s in r.json()["schedule"]}
    # 51일령 기준: 7·49일령 지남(밀림), 56일령 5일 뒤(이번 주), 112일령 예정
    assert sched[7]["status"] == "overdue" and sched[49]["status"] == "overdue"
    assert sched[56]["status"] == "due" and sched[112]["status"] == "upcoming"
    assert sched[56]["planned"] == (T + dt.timedelta(days=5)).isoformat()
    # 접종 기록 → 완료
    r = client.post(f"/api/flocks/{fid}/vaccinations", headers=v, json={"date": (T - dt.timedelta(days=44)).isoformat(), "vaccine_id": nd["id"], "program_item_id": sched[7]["item_id"], "lot": "A123", "birds": 20000})
    assert {s["age_days"]: s["status"] for s in r.json()["schedule"]}[7] == "done"
    assert r.json()["vaccinations"][0]["lot"] == "A123" and r.json()["vaccinations"][0]["house"] == "1동"
    # 같은 항목 두 번은 안 됨
    assert client.post(f"/api/flocks/{fid}/vaccinations", headers=v, json={"date": T.isoformat(), "vaccine_id": nd["id"], "program_item_id": sched[7]["item_id"]}).status_code == 409
    # 분석기·보고서용 표시 이름
    flocks = client.get(f"/api/farms/{client.ids['farm']}/flocks", headers=v).json()["flocks"]
    assert flocks[0]["program"] == "반석 산란계 v1"
    # 농장은 보기만
    seen = client.get(f"/api/flocks/{fid}/vaccination", headers=f).json()
    assert seen["current"]["label"] == "반석 산란계 v1" and seen["can_edit"] is False
    assert client.post(f"/api/flocks/{fid}/vaccinations", headers=f, json={"date": T.isoformat(), "vaccine_id": nd["id"]}).status_code == 403
    # 반석 접종 일정판
    due = client.get("/api/vaccination/due", headers=v).json()["items"]
    assert {d["age_days"] for d in due} == {49, 56}


def test_program_in_use_needs_new_version_and_change_history(client):
    v = H(client, "01011111111")
    nd, kill, p = make_program(client, v)
    fid = client.ids["flock"]
    client.post(f"/api/flocks/{fid}/program", headers=v, json={"program_id": p["id"], "from_date": (T - dt.timedelta(days=50)).isoformat()})
    body = {"name": "반석 산란계", "items": [{"age_days": 7, "vaccine_id": nd["id"]}, {"age_days": 63, "vaccine_id": kill["id"]}]}
    r = client.put(f"/api/programs/{p['id']}", headers=v, json=body)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "program_in_use"
    p2 = client.post(f"/api/programs/{p['id']}/new-version", headers=v, json=body).json()
    assert p2["version"] == 2 and p2["based_on_id"] == p["id"]
    # 계군을 v2로 변경 (오늘부터) → 이력 2줄, 오늘 이후 항목은 v2 기준
    r = client.post(f"/api/flocks/{fid}/program", headers=v, json={"program_id": p2["id"], "from_date": T.isoformat(), "reason": "IB 유행으로 사독 앞당김"}).json()
    assert [h["label"] for h in r["history"]] == ["반석 산란계 v1", "반석 산란계 v2"]
    assert r["history"][0]["to"] == (T - dt.timedelta(days=1)).isoformat()
    future = [s for s in r["schedule"] if s["planned"] >= T.isoformat()]
    assert {s["program"] for s in future} == {"반석 산란계 v2"} and future[0]["age_days"] == 63
    # 프로그램 중단
    r = client.post(f"/api/flocks/{fid}/program", headers=v, json={"program_id": None, "from_date": (T + dt.timedelta(days=1)).isoformat()}).json()
    assert r["current"]["label"] is None
    flocks = client.get(f"/api/farms/{client.ids['farm']}/flocks", headers=v).json()["flocks"]
    assert flocks[0]["program"] is None
