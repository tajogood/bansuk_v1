import io
import json
import os
import zipfile

os.environ["DATABASE_URL"] = "sqlite:///./test_bansuk.db"

import numpy as np  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402

from app.db import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Farm, UserFarm  # noqa: E402
from app.vision.polygon import mask_polygon  # noqa: E402
from tests.helpers import make_user  # noqa: E402


def jpeg(color=(200, 80, 90), seed=0) -> bytes:
    img = Image.new("RGB", (640, 480), color)
    d = ImageDraw.Draw(img)
    d.ellipse((100 + seed, 100, 300, 300), fill=(150, 40, 60))
    buf = io.BytesIO()
    img.save(buf, "JPEG")
    return buf.getvalue()


@pytest.fixture()
def client():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    db = SessionLocal()
    farm = Farm(name="사진농장")
    db.add(farm)
    db.flush()
    owner, vet = make_user("농장주", "01000000000", "farm_owner"), make_user("수의", "01011111111", "bansuk_vet")
    db.add_all([owner, vet])
    db.flush()
    db.add(UserFarm(user_id=owner.id, farm_id=farm.id))
    db.commit()
    fid = farm.id
    db.close()
    with TestClient(app) as c:
        c.farm_id = fid
        yield c


def H(c, phone):
    return {"Authorization": "Bearer " + c.post("/api/auth/login", json={"phone": phone, "pin": "1234"}).json()["token"]}


def test_archive_upload_tag_and_export(client):
    c = client
    v, o = H(c, "01011111111"), H(c, "01000000000")
    files = [("files", (f"p{i}.jpg", jpeg(seed=i * 10), "image/jpeg")) for i in range(3)]
    # 농장 계정은 못 씀
    assert c.post("/api/labeling/upload", headers=o, files=files[:1]).status_code == 403
    r = c.post("/api/labeling/upload", headers=v, files=files, data={"farm_id": str(c.farm_id)})
    assert r.status_code == 200, r.text
    assert r.json()["saved"] == 3 and r.json()["auto"] is False
    # 같은 사진 다시 올리면 건너뜀
    assert c.post("/api/labeling/upload", headers=v, files=files[:1]).json()["duplicates"] == 1

    s = c.get("/api/labeling/summary", headers=v).json()
    assert s["todo"] == 3 and s["done"] == 0 and s["model"]["enabled"] is False
    items = c.get("/api/labeling/photos?status=todo", headers=v).json()["items"]
    assert len(items) == 3 and items[0]["farm"] == "사진농장"
    pid = items[0]["id"]
    d = c.get(f"/api/labeling/photos/{pid}", headers=v).json()
    assert d["next_id"] == items[1]["id"] and d["prev_id"] is None and d["width"] == 640

    # 아무것도 없이 완료는 안 됨
    assert c.put(f"/api/labeling/photos/{pid}", headers=v, json={"status": "done"}).status_code == 400
    bad = {"status": "done", "regions": [{"organ": "wing", "points": [[0, 0], [1, 0], [1, 1]]}]}
    assert c.put(f"/api/labeling/photos/{pid}", headers=v, json=bad).status_code == 400
    body = {
        "status": "done", "diseases": ["fatty_liver"],
        "regions": [{"organ": "liver", "lesions": ["hemorrhage", "discolor"], "points": [[0.15, 0.2], [0.47, 0.2], [0.47, 0.62], [0.15, 0.62]]},
                    {"organ": "fat", "points": [[0.6, 0.6], [0.9, 0.6], [0.8, 0.9]]}],
    }
    r = c.put(f"/api/labeling/photos/{pid}", headers=v, json=body)
    assert r.status_code == 200, r.text
    regions = r.json()["regions"]
    assert {x["organ"] for x in regions} == {"liver", "fat"} and all(x["status"] == "confirmed" for x in regions)
    # 영역 하나 지우고 소견 고치기 (id로 유지)
    liver = next(x for x in regions if x["organ"] == "liver")
    body["regions"] = [{**liver, "lesions": ["hemorrhage"]}]
    r = c.put(f"/api/labeling/photos/{pid}", headers=v, json=body).json()
    assert len(r["regions"]) == 1 and r["regions"][0]["id"] == liver["id"] and r["regions"][0]["lesions"] == ["hemorrhage"]
    # 두 번째는 '이상 없음', 세 번째는 건너뜀
    c.put(f"/api/labeling/photos/{items[1]['id']}", headers=v, json={"status": "done", "normal": True})
    c.put(f"/api/labeling/photos/{items[2]['id']}", headers=v, json={"status": "skip", "note": "흐림"})
    s = c.get("/api/labeling/summary", headers=v).json()
    assert (s["todo"], s["done"], s["skip"], s["normal"]) == (0, 2, 1, 1)
    assert next(x for x in s["organs"] if x["organ"] == "liver")["count"] == 1
    assert s["diseases"] == [{"disease": "fatty_liver", "count": 1}]
    assert len(c.get("/api/labeling/photos?status=done&disease=fatty_liver", headers=v).json()["items"]) == 1

    # 학습 데이터 내보내기
    z = c.get("/api/labeling/export.zip", headers=v)
    assert z.status_code == 200
    zf = zipfile.ZipFile(io.BytesIO(z.content))
    ds = json.loads(zf.read("dataset.json"))
    coco = json.loads(zf.read("coco.json"))
    assert ds["classes"] == ["liver"] and len(ds["images"]) == 2
    assert f"images/{pid}.jpg" in zf.namelist()
    ann = coco["annotations"][0]
    assert ann["category_id"] == 1 and ann["bbox"][2] > 0 and len(ann["segmentation"][0]) == 8

    # 지난 사진 지우기
    assert c.delete(f"/api/labeling/photos/{items[2]['id']}", headers=v).status_code == 200
    assert c.get("/api/labeling/summary", headers=v).json()["total"] == 2


class FakeDetector:
    version = "fake-1"
    classes = ["liver", "intestine"]

    def detect(self, data):
        return [{"organ": "liver", "score": 0.91, "points": [[0.1, 0.1], [0.4, 0.1], [0.4, 0.5]]},
                {"organ": "intestine", "score": 0.7, "points": [[0.5, 0.5], [0.9, 0.5], [0.9, 0.9]]}]


def test_auto_suggestions_must_be_confirmed(client, monkeypatch):
    c = client
    v = H(c, "01011111111")
    c.post("/api/labeling/upload", headers=v, files=[("files", ("a.jpg", jpeg(), "image/jpeg"))])
    pid = c.get("/api/labeling/photos?status=todo", headers=v).json()["items"][0]["id"]
    assert c.post(f"/api/labeling/photos/{pid}/auto", headers=v).status_code == 409
    import app.routers.labeling as lab
    import app.vision as vision

    monkeypatch.setattr(lab, "get_detector", lambda: FakeDetector())
    monkeypatch.setattr(vision, "get_detector", lambda: FakeDetector())
    r = c.post(f"/api/labeling/photos/{pid}/auto", headers=v).json()
    assert r["added"] == 2 and all(x["status"] == "suggested" for x in r["regions"])
    assert c.get("/api/labeling/summary", headers=v).json()["suggested"] == 1
    assert len(c.get("/api/labeling/photos?status=suggested", headers=v).json()["items"]) == 1
    regs = r["regions"]
    # 제안이 남은 채로 완료 불가
    assert c.put(f"/api/labeling/photos/{pid}", headers=v, json={"status": "done", "regions": regs}).status_code == 400
    # 간은 확인, 장은 '틀림'으로 지우고 맹장으로 새로 그림
    liver = next(x for x in regs if x["organ"] == "liver")
    body = {"status": "done", "regions": [{**liver, "status": "confirmed"},
                                          {"organ": "cecum", "points": [[0.5, 0.5], [0.8, 0.5], [0.7, 0.8]]}]}
    out = c.put(f"/api/labeling/photos/{pid}", headers=v, json=body).json()
    assert sorted((x["organ"], x["source"], x["status"]) for x in out["regions"]) == [
        ("cecum", "manual", "confirmed"), ("liver", "auto", "confirmed")]
    # 다시 돌려도 확인한 간은 그대로, 같은 장기는 다시 제안하지 않음
    out = c.post(f"/api/labeling/photos/{pid}/auto", headers=v).json()
    assert [x["organ"] for x in out["regions"] if x["status"] == "suggested"] == ["intestine"]


def test_mask_polygon_traces_outline():
    yy, xx = np.mgrid[0:200, 0:300]
    mask = (xx - 150) ** 2 + (yy - 100) ** 2 < 60 ** 2
    mask[5:15, 5:15] = True  # 작은 덩어리는 버린다
    pts = mask_polygon(mask)
    assert pts and 8 <= len(pts) <= 60
    for x, y in pts:
        assert abs(((x - 150) ** 2 + (y - 100) ** 2) ** 0.5 - 60) < 6


def _fake_onnx(path):
    """Mask R-CNN과 같은 입출력 모양의 작은 ONNX: 빨강 채널이 0.7보다 어두운 곳을 '간'으로 잡는다."""
    onnx = pytest.importorskip("onnx")
    from onnx import TensorProto, helper

    def const(name, arr, dtype):
        return helper.make_node("Constant", [], [name], value=helper.make_tensor(name + "_v", dtype, arr.shape, arr.flatten().tolist()))

    nodes = [
        const("idx", np.array(0, dtype=np.int64), TensorProto.INT64),
        helper.make_node("Gather", ["images", "idx"], ["red"], axis=0),
        const("thr", np.array(0.7, dtype=np.float32), TensorProto.FLOAT),
        helper.make_node("Less", ["red", "thr"], ["dark"]),
        helper.make_node("Cast", ["dark"], ["darkf"], to=TensorProto.FLOAT),
        const("axes", np.array([0, 1], dtype=np.int64), TensorProto.INT64),
        helper.make_node("Unsqueeze", ["darkf", "axes"], ["masks"]),
        const("boxes", np.array([[100, 100, 300, 300]], dtype=np.float32), TensorProto.FLOAT),
        const("labels", np.array([1], dtype=np.int64), TensorProto.INT64),
        const("scores", np.array([0.88], dtype=np.float32), TensorProto.FLOAT),
    ]
    graph = helper.make_graph(
        nodes, "fake",
        [helper.make_tensor_value_info("images", TensorProto.FLOAT, [3, "H", "W"])],
        [helper.make_tensor_value_info("boxes", TensorProto.FLOAT, [None, 4]),
         helper.make_tensor_value_info("labels", TensorProto.INT64, [None]),
         helper.make_tensor_value_info("scores", TensorProto.FLOAT, [None]),
         helper.make_tensor_value_info("masks", TensorProto.FLOAT, [None, 1, "H", "W"])],
    )
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)])
    model.ir_version = 8
    onnx.save(model, str(path))
    path.with_suffix(".json").write_text(json.dumps({"version": "fake-onnx", "classes": ["liver"], "input_size": 640}))


def test_onnx_detector_end_to_end(client, tmp_path, monkeypatch):
    pytest.importorskip("onnxruntime")
    model = tmp_path / "organs.onnx"
    _fake_onnx(model)
    monkeypatch.setenv("VISION_MODEL", str(model))
    from app.vision import get_detector

    det = get_detector()
    assert det and det.version == "fake-onnx"
    found = det.detect(jpeg())
    assert len(found) == 1 and found[0]["organ"] == "liver" and found[0]["score"] == 0.88
    xs = [p[0] for p in found[0]["points"]]
    ys = [p[1] for p in found[0]["points"]]
    # 원 (100~300, 100~300) / (640x480) 근처를 따라간다
    assert 0.13 < min(xs) < 0.19 and 0.44 < max(xs) < 0.5 and 0.18 < min(ys) < 0.24 and 0.6 < max(ys) < 0.66
    v = H(client, "01011111111")
    assert client.get("/api/labeling/summary", headers=v).json()["model"] == {"enabled": True, "version": "fake-onnx", "classes": ["liver"]}
    client.post("/api/labeling/upload", headers=v, files=[("files", ("a.jpg", jpeg(), "image/jpeg"))])
    pid = client.get("/api/labeling/photos?status=todo", headers=v).json()["items"][0]["id"]
    r = client.post(f"/api/labeling/photos/{pid}/auto", headers=v).json()
    assert r["added"] == 1 and r["regions"][0]["source"] == "auto" and r["auto_model"] == "fake-onnx"
