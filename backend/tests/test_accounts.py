import os

os.environ["DATABASE_URL"] = "sqlite:///./test_bansuk.db"
os.environ["BANSUK_ADMIN_PHONE"] = "010-9999-9999"
os.environ["BANSUK_ADMIN_INITIAL_PIN"] = "135790"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.db import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402

ADMIN = "01099999999"


@pytest.fixture()
def client():
    Base.metadata.drop_all(engine)
    with TestClient(app) as c:  # 시작할 때 관리자 계정이 만들어진다
        yield c


def login(c, phone, pin):
    return c.post("/api/auth/login", json={"phone": phone, "pin": pin})


def bearer(r):
    return {"Authorization": f"Bearer {r.json()['token']}"}


def admin_headers(c):
    r = login(c, ADMIN, "135790")
    h = bearer(r)
    assert c.post("/api/auth/change-pin", headers=h, json={"current": "135790", "new": "bansukAdmin1"}).status_code == 200
    return h


def test_admin_exists_on_first_start_and_must_change_pin(client):
    r = login(client, ADMIN, "135790")
    assert r.status_code == 200
    assert r.json()["user"]["must_change_pin"] is True
    assert r.json()["user"]["role"] == "admin"
    h = bearer(r)
    # 비밀번호를 바꾸기 전에는 다른 화면을 못 쓴다
    blocked = client.get("/api/admin/users", headers=h)
    assert blocked.status_code == 403 and blocked.json()["detail"]["code"] == "pin_change_required"
    # 반석 계정 규칙: 영문+숫자 8자 이상
    assert client.post("/api/auth/change-pin", headers=h, json={"current": "135790", "new": "12345678"}).status_code == 400
    ok = client.post("/api/auth/change-pin", headers=h, json={"current": "135790", "new": "bansukAdmin1"})
    assert ok.status_code == 200 and ok.json()["user"]["must_change_pin"] is False
    assert client.get("/api/admin/users", headers=h).status_code == 200


def test_admin_creates_farm_and_farm_account_with_temp_pin(client):
    h = admin_headers(client)
    f = client.post(
        "/api/admin/farms",
        headers=h,
        json={"name": "새농장", "region": "충남", "houses": [{"name": "1동"}, {"name": "2동"}, {"name": "육성사", "kind": "rearing"}]},
    )
    assert f.status_code == 200, f.text
    farm = f.json()["farm"]
    assert [x["name"] for x in farm["houses"]] == ["1동", "2동", "육성사"]

    u = client.post("/api/admin/users", headers=h, json={"name": "김농장", "phone": "010-3333-4444", "role": "farm_owner", "farm_ids": [farm["id"]]})
    assert u.status_code == 200, u.text
    temp = u.json()["temp_pin"]
    assert len(temp) == 6 and temp.isdigit()
    assert u.json()["user"]["status"] == "temp"

    r = login(client, "01033334444", temp)
    oh = bearer(r)
    assert r.json()["user"]["pin_rule"]["kind"] == "digits6"
    # 쉬운 번호, 휴대폰 번호 일부는 안 됨
    for bad in ("111111", "123456", "334444", "12ab"):
        assert client.post("/api/auth/change-pin", headers=oh, json={"current": temp, "new": bad}).status_code == 400, bad
    assert client.post("/api/auth/change-pin", headers=oh, json={"current": temp, "new": "582914"}).status_code == 200
    me = client.get("/api/me", headers=oh).json()
    assert [x["name"] for x in me["farms"]] == ["새농장"]
    # 농장 계정은 관리 화면을 못 쓴다
    assert client.get("/api/admin/users", headers=oh).status_code == 403
    # 다시 로그인: 새 비밀번호만 통함
    assert login(client, "01033334444", temp).status_code == 401
    assert login(client, "01033334444", "582914").status_code == 200


def test_phone_and_tokens_are_not_stored_in_plain_text(client):
    h = admin_headers(client)
    client.post("/api/admin/users", headers=h, json={"name": "이수의", "phone": "010-5555-6666", "role": "bansuk_vet"})
    with SessionLocal() as db:
        dump = " ".join(str(r) for r in db.execute(text("select * from app_user")).all())
        tokens = [r[0] for r in db.execute(text("select token_hash from auth_token")).all()]
    assert "01055556666" not in dump and "5555" not in dump
    assert "01099999999" not in dump
    assert h["Authorization"].split()[1] not in tokens


def test_reset_pin_logs_out_and_requires_new_pin(client):
    h = admin_headers(client)
    u = client.post("/api/admin/users", headers=h, json={"name": "박연구", "phone": "01077778888", "role": "bansuk_staff"}).json()
    uid, temp = u["user"]["id"], u["temp_pin"]
    vh = bearer(login(client, "01077778888", temp))
    client.post("/api/auth/change-pin", headers=vh, json={"current": temp, "new": "research2026"})
    assert client.get("/api/me", headers=vh).status_code == 200

    r = client.post(f"/api/admin/users/{uid}/reset-pin", headers=h)
    new_temp = r.json()["temp_pin"]
    assert client.get("/api/me", headers=vh).status_code == 401  # 기존 로그인 끊김
    r2 = login(client, "01077778888", new_temp)
    assert r2.json()["user"]["must_change_pin"] is True


def test_lockout_after_five_wrong_pins(client):
    admin_headers(client)
    for _ in range(4):
        assert login(client, ADMIN, "wrong").status_code == 401
    assert login(client, ADMIN, "wrong").status_code == 423
    assert login(client, ADMIN, "bansukAdmin1").status_code == 423  # 맞아도 잠김 동안은 안 됨


def test_cannot_remove_last_admin_or_deactivate_self(client):
    h = admin_headers(client)
    me = client.get("/api/me", headers=h).json()["user"]
    assert client.patch(f"/api/admin/users/{me['id']}", headers=h, json={"role": "bansuk_vet"}).status_code == 400
    assert client.patch(f"/api/admin/users/{me['id']}", headers=h, json={"active": False}).status_code == 400


def test_deactivated_account_cannot_log_in(client):
    h = admin_headers(client)
    farm = client.post("/api/admin/farms", headers=h, json={"name": "A농장", "houses": [{"name": "1동"}]}).json()["farm"]
    u = client.post("/api/admin/users", headers=h, json={"name": "최농장", "phone": "01012121212", "role": "farm_owner", "farm_ids": [farm["id"]]}).json()
    client.patch(f"/api/admin/users/{u['user']['id']}", headers=h, json={"active": False})
    assert login(client, "01012121212", u["temp_pin"]).status_code == 401
    log = client.get("/api/admin/audit", headers=h).json()["items"]
    assert {"계정 생성", "계정 수정", "농장 생성", "첫 비밀번호 설정"} <= {x["action"] for x in log}


def test_english_responses(client):
    en = {"Accept-Language": "en"}
    r = client.post("/api/auth/login", json={"phone": ADMIN, "pin": "nope"}, headers=en)
    assert r.json()["detail"] == "Phone number or password is incorrect"
    h = {**bearer(login(client, ADMIN, "135790")), **en}
    blocked = client.get("/api/admin/users", headers=h)
    assert blocked.json()["detail"]["message"] == "You need to set a new password"
    me = client.get("/api/me", headers=h).json()["user"]
    assert me["role_label"] == "Bansuk admin" and me["pin_rule"]["rule"].startswith("at least 8")
    # 한국어 요청은 그대로
    assert client.get("/api/me", headers=bearer(login(client, ADMIN, "135790"))).json()["user"]["role_label"] == "반석 관리자"
