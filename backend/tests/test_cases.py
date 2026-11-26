import datetime as dt
import io
import os

os.environ["DATABASE_URL"] = "sqlite:///./test_bansuk.db"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402

from app.db import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Farm, Flock, FlockLocation, House, UserFarm  # noqa: E402
from tests.helpers import make_user  # noqa: E402

TODAY = dt.date.today()


@pytest.fixture()
def client():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    db = SessionLocal()
    farm, other = Farm(name="신고농장"), Farm(name="남의농장")
    db.add_all([farm, other])
    db.flush()
    h = House(farm_id=farm.id, name="2동")
    db.add(h)
    db.flush()
    fl = Flock(farm_id=farm.id, placed_on=TODAY - dt.timedelta(days=200), placed_count=10000)
    db.add(fl)
    db.flush()
    db.add(FlockLocation(flock_id=fl.id, house_id=h.id, from_date=fl.placed_on, start_count=10000))
    owner = make_user("김농장", "01000000000", "farm_owner")
    stranger = make_user("남농장", "01099990000", "farm_owner")
    vet = make_user("이수의", "01011111111", "bansuk_vet")
    vet2 = make_user("박수의", "01022223333", "bansuk_vet")
    admin = make_user("관리자", "01033334444", "admin")
    db.add_all([owner, stranger, vet, vet2, admin])
    db.flush()
    db.add_all([UserFarm(user_id=owner.id, farm_id=farm.id), UserFarm(user_id=stranger.id, farm_id=other.id)])
    db.commit()
    ids = {"farm": farm.id, "house": h.id, "flock": fl.id, "vet": vet.id}
    db.close()
    with TestClient(app) as c:
        c.ids = ids
        yield c


def H(c, phone):
    t = c.post("/api/auth/login", json={"phone": phone, "pin": "1234"}).json()["token"]
    return {"Authorization": f"Bearer {t}"}


def unread(c, h):
    return c.get("/api/notifications/count", headers=h).json()["unread"]


def jpeg(color=(180, 40, 40), size=(800, 600)):
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "JPEG")
    return buf.getvalue()


def test_full_flow_report_schedule_necropsy_share(client):
    farm, vet, vet2 = H(client, "01000000000"), H(client, "01011111111"), H(client, "01022223333")
    # 1. 농장 신고 → 반석 전원에게 알림
    r = client.post("/api/cases", headers=farm, json={"farm_id": client.ids["farm"], "house_id": client.ids["house"], "dead_count": 35, "onset": "yesterday", "symptoms": ["sudden_death", "lay_drop"], "note": "새벽에 많이 죽음"})
    assert r.status_code == 200, r.text
    case = r.json()
    cid = case["id"]
    assert case["status"] == "reported" and case["flock"]["id"] == client.ids["flock"]
    assert unread(client, vet) == 1 and unread(client, vet2) == 1
    # 2. 반석 시간 제안 → 농장에 알림, 담당 수의사 지정
    day = (TODAY + dt.timedelta(days=1)).isoformat()
    r = client.post(f"/api/cases/{cid}/propose", headers=vet, json={"slots": [f"{day}T10:00", f"{day}T14:00"], "message": "내일 가능합니다"})
    assert r.json()["status"] == "scheduling" and r.json()["awaiting"] == "farm"
    assert r.json()["vet"]["id"] == client.ids["vet"]
    assert unread(client, farm) == 1
    # 3. 농장: 다른 시간 요청 → 담당 수의사에게만 알림
    r = client.post(f"/api/cases/{cid}/request", headers=farm, json={"at": f"{day}T16:00", "message": "오후 늦게 돼요"})
    assert r.json()["awaiting"] == "bansuk"
    assert unread(client, vet) == 2 and unread(client, vet2) == 1
    # 농장 요청 시간으로 반석 확정
    r = client.post(f"/api/cases/{cid}/confirm", headers=vet, json={"at": f"{day}T16:00"})
    assert r.json()["status"] == "scheduled" and r.json()["scheduled_at"] == f"{day}T16:00"
    # 4. 사진 (반석 부검 사진은 공유 전까지 농장에 안 보임)
    r = client.post(f"/api/cases/{cid}/photos", headers=vet, files=[("files", ("a.jpg", jpeg(), "image/jpeg")), ("files", ("b.txt", b"nope", "text/plain"))])
    assert r.json()["upload"]["saved"] == 1 and len(r.json()["upload"]["failed"]) == 1
    photo = r.json()["photos"][0]
    assert client.get(photo["thumb"]).status_code == 200
    assert client.get(photo["full"].replace("sig=", "sig=x")).status_code == 403
    assert client.get(f"/api/cases/{cid}", headers=farm).json()["photos"] == []
    # 5. 결과 저장 (내부 메모는 농장에 안 보임), 공유
    res = {"birds_examined": 5, "findings": [{"organ": "liver", "lesions": ["swelling", "hemorrhage"]}], "suspected": ["fatty_liver"], "samples": ["pcr"], "summary": "간 종대·출혈", "advice": "사료 에너지 조절", "internal_note": "내부용"}
    r = client.put(f"/api/cases/{cid}/result", headers=vet, json=res)
    assert r.json()["status"] == "done"
    assert "result" not in client.get(f"/api/cases/{cid}", headers=farm).json()
    r = client.post(f"/api/cases/{cid}/share", headers=vet)
    assert r.json()["status"] == "shared"
    seen = client.get(f"/api/cases/{cid}", headers=farm).json()
    assert seen["result"]["summary"] == "간 종대·출혈" and "internal_note" not in seen["result"]
    assert len(seen["photos"]) == 1
    kinds = [e["kind"] for e in seen["events"]]
    assert kinds[:4] == ["reported", "proposed", "requested", "confirmed"] and kinds[-1] == "shared"
    # 열어 보면 그 건의 알림은 읽음
    assert unread(client, farm) == 0


def test_farm_accepts_proposed_time(client):
    farm, vet = H(client, "01000000000"), H(client, "01011111111")
    cid = client.post("/api/cases", headers=farm, json={"farm_id": client.ids["farm"], "dead_count": 10}).json()["id"]
    day = (TODAY + dt.timedelta(days=2)).isoformat()
    client.post(f"/api/cases/{cid}/propose", headers=vet, json={"slots": [f"{day}T09:30"]})
    assert client.post(f"/api/cases/{cid}/accept", headers=farm, json={"at": f"{day}T11:00"}).status_code == 400
    r = client.post(f"/api/cases/{cid}/accept", headers=farm, json={"at": f"{day}T09:30"})
    assert r.json()["status"] == "scheduled"
    n = client.get("/api/notifications", headers=vet).json()
    assert n["items"][0]["kind"] == "case_accepted" and n["items"][0]["data"]["at"] == f"{day}T09:30"


def test_permissions(client):
    farm, stranger, vet = H(client, "01000000000"), H(client, "01099990000"), H(client, "01011111111")
    cid = client.post("/api/cases", headers=farm, json={"farm_id": client.ids["farm"], "dead_count": 3}).json()["id"]
    assert client.get(f"/api/cases/{cid}", headers=stranger).status_code == 403
    assert client.get("/api/cases", headers=stranger).json()["cases"] == []
    assert client.post("/api/cases", headers=stranger, json={"farm_id": client.ids["farm"]}).status_code == 403
    # 농장은 일정 제안·결과 작성 불가
    assert client.post(f"/api/cases/{cid}/propose", headers=farm, json={"slots": ["2030-01-01T10:00"]}).status_code == 403
    assert client.put(f"/api/cases/{cid}/result", headers=farm, json={}).status_code == 403
    # 반석은 결과 없이 공유 불가
    assert client.post(f"/api/cases/{cid}/share", headers=vet).status_code == 400
    # 메시지는 양쪽 다
    assert client.post(f"/api/cases/{cid}/message", headers=farm, json={"text": "사진 더 필요하세요?"}).status_code == 200
    assert client.post(f"/api/cases/{cid}/message", headers=vet, json={"text": "네"}).status_code == 200


def test_farm_photo_at_report_notifies_bansuk(client):
    farm, vet = H(client, "01000000000"), H(client, "01011111111")
    cid = client.post("/api/cases", headers=farm, json={"farm_id": client.ids["farm"], "dead_count": 7}).json()["id"]
    before = unread(client, vet)
    r = client.post(f"/api/cases/{cid}/photos", headers=farm, files=[("files", ("x.jpg", jpeg((30, 30, 30), (4000, 3000)), "image/jpeg"))])
    p = r.json()["photos"][0]
    assert p["stage"] == "report" and max(p["width"], p["height"]) == 2560
    assert unread(client, vet) == before + 1


def test_final_diagnosis_codes(client):
    farm, vet = H(client, "01000000000"), H(client, "01011111111")
    cid = client.post("/api/cases", headers=farm, json={"farm_id": client.ids["farm"], "dead_count": 30}).json()["id"]
    # 부검 전에는 진단 못 함
    assert client.put(f"/api/cases/{cid}/diagnosis", headers=vet, json={"final_diseases": ["ib"]}).status_code == 400
    res = {"birds_examined": 4, "suspected": ["ib", "colibacillosis"], "samples": ["pcr"], "summary": "기관 점액", "final_diagnosis": "옛 화면 값"}
    client.put(f"/api/cases/{cid}/result", headers=vet, json=res)
    # 결과를 다시 저장할 때 final_diagnosis를 안 보내면 그대로 둔다
    client.put(f"/api/cases/{cid}/result", headers=vet, json={k: v for k, v in res.items() if k != "final_diagnosis"})
    c = client.get(f"/api/cases/{cid}", headers=vet).json()
    assert c["result"]["final_diagnosis"] == "옛 화면 값" and c["needs_diagnosis"] is True
    client.post(f"/api/cases/{cid}/share", headers=vet)
    # 유행 질병: 최종 진단 전에는 의심 질병 2개
    e = client.get("/api/epidemic?days=30", headers=vet).json()
    assert {d["disease"] for d in e["diseases"]} == {"ib", "colibacillosis"} and e["confirmed"] == 0
    # 검증
    assert client.put(f"/api/cases/{cid}/diagnosis", headers=vet, json={"final_diseases": ["xx"]}).status_code == 400
    assert client.put(f"/api/cases/{cid}/diagnosis", headers=vet, json={"final_diseases": ["undetermined", "ib"]}).status_code == 400
    assert client.put(f"/api/cases/{cid}/diagnosis", headers=farm, json={"final_diseases": ["ib"]}).status_code == 403
    r = client.put(f"/api/cases/{cid}/diagnosis", headers=vet, json={"final_diseases": ["ib"], "final_diagnosis": "IB (RT-PCR 양성)"})
    assert r.status_code == 200
    d = r.json()
    assert d["result"]["final_diseases"] == ["ib"] and d["needs_diagnosis"] is False and d["result"]["diagnosed_at"]
    assert d["events"][-1]["kind"] == "diagnosed"
    # 공유한 건이라 농장에 알림, 농장도 진단을 봄
    assert client.get("/api/notifications", headers=farm).json()["items"][0]["kind"] == "case_diagnosed"
    assert client.get(f"/api/cases/{cid}", headers=farm).json()["result"]["final_diseases"] == ["ib"]
    # 유행 질병: 최종 진단만, 확인으로 셈
    e = client.get("/api/epidemic?days=30", headers=vet).json()
    assert [d["disease"] for d in e["diseases"]] == ["ib"] and e["confirmed"] == 1
    # 원인 미확정이면 유행 질병에서 빠진다
    client.put(f"/api/cases/{cid}/diagnosis", headers=vet, json={"final_diseases": ["undetermined"]})
    assert client.get("/api/epidemic?days=30", headers=vet).json()["total"] == 0
