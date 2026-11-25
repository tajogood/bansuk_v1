import datetime as dt
import io
import os

os.environ["DATABASE_URL"] = "sqlite:///./test_bansuk.db"

import openpyxl  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Farm, Flock, FlockLocation, House, NecropsyCase, UserFarm  # noqa: E402
from tests.helpers import make_user  # noqa: E402

T = dt.date.today()


@pytest.fixture()
def client():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    db = SessionLocal()
    farm, other = Farm(name="검사농장"), Farm(name="옆농장")
    db.add_all([farm, other])
    db.flush()
    h = House(farm_id=farm.id, name="4동")
    db.add(h)
    db.flush()
    fl = Flock(farm_id=farm.id, placed_on=T - dt.timedelta(days=162), placed_count=30000)  # 오늘 163일령
    db.add(fl)
    db.flush()
    db.add(FlockLocation(flock_id=fl.id, house_id=h.id, from_date=fl.placed_on, start_count=30000))
    case = NecropsyCase(farm_id=farm.id, house_id=h.id, flock_id=fl.id, status="done", dead_count=12)
    db.add(case)
    owner, vet = make_user("농장주", "01000000000", "farm_owner"), make_user("수의", "01011111111", "bansuk_vet")
    other_owner = make_user("옆농장주", "01033333333", "farm_owner")
    db.add_all([owner, vet, other_owner])
    db.flush()
    db.add_all([UserFarm(user_id=owner.id, farm_id=farm.id), UserFarm(user_id=other_owner.id, farm_id=other.id)])
    db.commit()
    ids = {"farm": farm.id, "house": h.id, "flock": fl.id, "case": case.id, "other": other.id}
    db.close()
    with TestClient(app) as c:
        c.ids = ids
        yield c


def H(c, phone):
    return {"Authorization": "Bearer " + c.post("/api/auth/login", json={"phone": phone, "pin": "1234"}).json()["token"]}


def test_pcr_from_case_issue_and_farm_view(client):
    c, ids = client, client.ids
    v, o, x = H(c, "01011111111"), H(c, "01000000000"), H(c, "01033333333")
    body = {
        "kind": "pcr", "farm_id": ids["farm"], "house_id": ids["house"], "case_id": ids["case"],
        "report_no": "BS26-PCR-0001", "sampled_on": T.isoformat(), "method": "RT-PCR", "target": "APV (115 bp)",
        "disease": "apv", "opinion": "음성으로 확인되었습니다.",
        "samples": [
            {"sample": "양성 대조", "result": "positive", "control": True},
            {"sample": "음성 대조", "result": "negative", "control": True},
            {"sample": "기관, 맹장편도", "result": "negative"},
        ],
    }
    # 농장은 입력 못 함
    assert c.post("/api/lab", headers=o, json=body).status_code == 403
    r = c.post("/api/lab", headers=v, json=body)
    assert r.status_code == 200, r.text
    lab = r.json()
    # 계군·일령은 계사와 채취일로 채워진다, 대조는 양성 판정에서 빠진다
    assert lab["flock_id"] == ids["flock"] and lab["age_days"] == 163
    assert lab["positive"] is False and lab["case"]["id"] == ids["case"]
    # 작성 중에는 농장에 안 보인다
    assert c.get("/api/lab", headers=o).json()["items"] == []
    assert c.get(f"/api/lab/{lab['id']}", headers=o).status_code == 404
    # 발행 → 농장 알림, 농장에서 보임 / 다른 농장은 못 봄
    r = c.post(f"/api/lab/{lab['id']}/issue", headers=v)
    assert r.status_code == 200 and r.json()["status"] == "issued"
    notes = c.get("/api/notifications", headers=o).json()["items"]
    assert notes[0]["kind"] == "lab_issued" and notes[0]["data"]["lab_id"] == lab["id"]
    assert [i["id"] for i in c.get("/api/lab", headers=o).json()["items"]] == [lab["id"]]
    assert c.get(f"/api/lab/{lab['id']}", headers=x).status_code == 403
    assert c.get("/api/lab", headers=x).json()["items"] == []
    # 부검 건으로 찾기
    assert len(c.get(f"/api/lab?case_id={ids['case']}", headers=v).json()["items"]) == 1
    # 발행한 결과는 바로 못 지운다
    assert c.delete(f"/api/lab/{lab['id']}", headers=v).status_code == 409
    c.post(f"/api/lab/{lab['id']}/unissue", headers=v)
    assert c.delete(f"/api/lab/{lab['id']}", headers=v).status_code == 200


def test_serology_titer_trend(client):
    c, ids = client, client.ids
    v, o = H(c, "01011111111"), H(c, "01000000000")
    for days_ago, ib, mg in [(80, [0, 0, 2, 1, 7], [7, 1, 2]), (20, [0, 0, 0, 0, 0, 0, 3, 4, 3], [0, 0, 0, 0, 2, 2, 3, 3])]:
        day = (T - dt.timedelta(days=days_ago)).isoformat()
        r = c.post("/api/lab", headers=v, json={
            "kind": "serology", "farm_id": ids["farm"], "house_id": ids["house"], "sampled_on": day,
            "sero": [{"antigen": "ib_elisa", "counts": ib}, {"antigen": "mg_elisa", "group_label": "1층", "counts": mg + [0, 0]}],
        })
        assert r.status_code == 200, r.text
        c.post(f"/api/lab/{r.json()['id']}/issue", headers=v)
    lab = r.json()
    assert lab["sero"][1]["counts"] == [0, 0, 0, 0, 2, 2, 3, 3]  # 끝의 0은 지운다
    assert lab["sero"][0]["n"] == 10 and lab["sero"][0]["mean"] == 7.0
    t = c.get(f"/api/lab/titers?farm_id={ids['farm']}&house_id={ids['house']}", headers=o).json()["series"]
    assert [s["antigen"] for s in t] == ["ib_elisa", "mg_elisa"]
    ib = t[0]["points"]
    assert [p["mean"] for p in ib] == [3.5, 7.0] and ib[0]["age_days"] == 83
    assert c.get(f"/api/lab/titers?farm_id={ids['farm']}", headers=H(c, "01033333333")).status_code == 403
    bad = c.post("/api/lab", headers=v, json={"kind": "serology", "farm_id": ids["farm"], "sero": [{"antigen": "xx", "counts": [1]}]})
    assert bad.status_code == 400


def test_standard_template_import(client):
    c, ids = client, client.ids
    v = H(c, "01011111111")
    tpl = c.get("/api/lab/template.xlsx", headers=v)
    assert tpl.status_code == 200
    wb = openpyxl.load_workbook(io.BytesIO(tpl.content))
    assert {"혈청", "PCR"} <= set(wb.sheetnames)
    # 템플릿 예시 줄을 우리 농장으로 바꾼다 + 모르는 농장 한 줄
    ws, p = wb["혈청"], wb["PCR"]
    for row in list(ws.iter_rows(min_row=2)) + list(p.iter_rows(min_row=2)):
        for cell in row:
            if cell.value == "예시농장":
                cell.value = "검사 농장"  # 띄어쓰기는 무시
            if cell.value == "1동":
                cell.value = "4동"
    ws.append(["없는농장", "1동", "2026-10-02", 10, "ND", "", 1, 2])
    buf = io.BytesIO()
    wb.save(buf)
    r = c.post("/api/lab/import", headers=v, files={"file": ("lab.xlsx", buf.getvalue())})
    assert r.status_code == 200, r.text
    out = r.json()
    assert len(out["created"]) == 2 and out["skipped"][0]["reason"] == "unknown_farm"
    items = c.get("/api/lab", headers=v).json()["items"]
    sero = next(i for i in items if i["kind"] == "serology")
    pcr = next(i for i in items if i["kind"] == "pcr")
    assert sero["antigens"] == ["ib_elisa", "mg_elisa"] and sero["status"] == "draft"
    d = c.get(f"/api/lab/{pcr['id']}", headers=v).json()
    assert d["report_no"] == "BS26-PCR-0001" and [s["control"] for s in d["samples"]] == [True, False]
    # 깨진 파일
    assert c.post("/api/lab/import", headers=v, files={"file": ("x.xlsx", b"not excel")}).status_code == 400


def test_epidemic_and_analyzer_sources(client):
    c, ids = client, client.ids
    v, o = H(c, "01011111111"), H(c, "01000000000")
    db = SessionLocal()
    case = db.get(NecropsyCase, ids["case"])
    case.performed_at = dt.datetime.combine(T - dt.timedelta(days=3), dt.time(10))
    case.suspected = ["apv", "colibacillosis"]
    db.commit()
    db.close()
    # 같은 농장 APV PCR 양성 (부검 4일 뒤) → 부검과 합쳐 한 번, 검사 확인
    r = c.post("/api/lab", headers=v, json={
        "kind": "pcr", "farm_id": ids["farm"], "house_id": ids["house"], "case_id": ids["case"], "sampled_on": (T - dt.timedelta(days=3)).isoformat(),
        "disease": "apv", "samples": [{"sample": "대조", "result": "positive", "control": True}, {"sample": "기관", "result": "positive"}],
    }).json()
    c.post(f"/api/lab/{r['id']}/issue", headers=v)
    e = c.get("/api/epidemic?days=30", headers=v).json()
    assert e["total"] == 2 and e["confirmed"] == 1
    apv = next(d for d in e["diseases"] if d["disease"] == "apv")
    assert apv["count"] == 1 and apv["confirmed"] == 1 and apv["recent"] == 1 and sum(apv["weekly"]) == 1
    assert e["recent"][0]["farm"] == "검사농장"
    # 농장 계정은 농장 이름 없이 본다
    eo = c.get("/api/epidemic?days=30", headers=o).json()
    assert eo["total"] == 2 and "farm" not in eo["recent"][0] and eo["show_farms"] is False
    # 분석기: 부검 건수 질병별, 검사 양성 비율
    cat = c.get("/api/analysis/catalog", headers=v).json()
    assert "lab" in cat["events"] and "necropsy" in cat["events"]
    q = {"source": "necropsy", "metric": "cases", "x": "month", "group": "disease"}
    res = c.post("/api/analysis/query", headers=v, json=q).json()
    assert {s["key"] for s in res["series"]} == {"d:apv", "d:colibacillosis"}
    q = {"source": "lab", "metric": "positive_rate", "x": "month", "group": "none"}
    res = c.post("/api/analysis/query", headers=v, json=q).json()
    assert res["series"][0]["points"][0][1] == 100.0
    assert c.post("/api/analysis/query", headers=v, json={"source": "lab", "metric": "lay_rate"}).status_code == 400
