import os

os.environ["DATABASE_URL"] = "sqlite:///./test_bansuk.db"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db import Base, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.seed import seed  # noqa: E402


@pytest.fixture(scope="module")
def client():
    Base.metadata.drop_all(engine)
    seed(reset=True)
    with TestClient(app) as c:
        yield c


PINS = {"01000000000": "246810", "01011111111": "bansuk2026"}


def auth(c, phone):
    return {"Authorization": "Bearer " + c.post("/api/auth/login", json={"phone": phone, "pin": PINS[phone]}).json()["token"]}


def test_farm_owner_cannot_use_analyzer(client):
    h = auth(client, "01000000000")
    assert client.get("/api/analysis/catalog", headers=h).status_code == 403
    assert client.post("/api/analysis/query", headers=h, json={}).status_code == 403


def test_query_groups_and_axes(client):
    h = auth(client, "01011111111")
    cat = client.get("/api/analysis/catalog", headers=h).json()
    assert "lay_rate" in cat["metrics"] and "age_weeks" in cat["x_axes"]
    r = client.post("/api/analysis/query", headers=h, json={"metric": "lay_rate", "x": "age_weeks", "group": "program"}).json()
    labels = {s["label"] for s in r["series"]}
    assert labels == {"프로그램 적용", "미적용"}
    for s in r["series"]:
        assert all(0 <= y <= 105 for _, y in s["points"])
    r2 = client.post("/api/analysis/query", headers=h, json={"metric": "mortality", "x": "month", "group": "house"}).json()
    assert len(r2["series"]) == 6
    bad = client.post("/api/analysis/query", headers=h, json={"metric": "nope"})
    assert bad.status_code == 400


def test_dashboard_crud_and_sharing(client):
    vet = auth(client, "01011111111")
    w = {"id": "w1", "title": "주령별 산란율", "chart": "line", "width": 2,
         "query": {"metric": "lay_rate", "x": "age_weeks", "group": "flock"}}
    d = client.post("/api/analysis/dashboards", headers=vet, json={"name": "산란 비교", "widgets": [w]}).json()
    assert d["mine"] and d["widgets"][0]["title"] == "주령별 산란율"
    d2 = client.put(f"/api/analysis/dashboards/{d['id']}", headers=vet,
                    json={"name": "산란 비교 v2", "shared": True, "widgets": [w, {**w, "id": "w2", "chart": "bar", "width": 1}]}).json()
    assert d2["name"] == "산란 비교 v2" and len(d2["widgets"]) == 2 and d2["shared"]
    lst = client.get("/api/analysis/dashboards", headers=vet).json()["dashboards"]
    assert any(x["id"] == d["id"] for x in lst)
    assert client.delete(f"/api/analysis/dashboards/{d['id']}", headers=vet).json()["ok"]


def test_catalog_and_series_in_english(client):
    h = {**auth(client, "01011111111"), "Accept-Language": "en"}
    cat = client.get("/api/analysis/catalog", headers=h).json()
    assert cat["metrics"]["lay_rate"]["label"] == "Lay rate"
    assert cat["metrics"]["share_xl"]["label"] == "Extra large share"
    r = client.post("/api/analysis/query", headers=h, json={"metric": "lay_rate", "x": "age_weeks", "group": "program"}).json()
    assert {s["label"] for s in r["series"]} <= {"Program applied", "Not applied"}
