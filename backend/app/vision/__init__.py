"""부검 사진 장기 자동 인식.

반석 사진으로 학습한 모델(ONNX 파일)이 있으면 사진을 올릴 때 장기 영역을 '제안'으로 붙이고,
수의사가 확인·수정하면 '확인'이 된다. 모델이 없으면 아무것도 하지 않는다 (수동 태깅만).

모델 파일
    VISION_MODEL (기본 backend/data/models/organs.onnx)
    같은 이름의 .json: {"version": "organs-2027-01", "classes": ["liver", ...], "input_size": 800,
                        "score_threshold": 0.5}
    scripts/train_organs.py 가 둘 다 만든다 (torchvision Mask R-CNN → ONNX).

모델 입력: float32 [3, H, W] 0~1 (긴 변 input_size로 줄임)
모델 출력: boxes [N, 4], labels [N] (1부터, classes[label-1]), scores [N], masks [N, 1, H, W] (선택)
"""
from __future__ import annotations

import datetime as dt
import io
import json
import logging
import os
import threading
from functools import lru_cache
from pathlib import Path

from PIL import Image

from .polygon import box_polygon, mask_polygon

log = logging.getLogger("bansuk.vision")

DEFAULT_MODEL = Path(__file__).resolve().parents[2] / "data" / "models" / "organs.onnx"


class Detector:
    def __init__(self, model_path: Path, meta: dict):
        import numpy as np  # noqa: F401 — onnxruntime과 함께 있어야 한다
        import onnxruntime as ort

        self.session = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
        self.input_name = self.session.get_inputs()[0].name
        self.output_names = [o.name for o in self.session.get_outputs()]
        self.classes: list[str] = meta["classes"]
        self.version: str = meta.get("version") or model_path.stem
        self.size: int = int(meta.get("input_size", 800))
        self.threshold: float = float(meta.get("score_threshold", 0.5))
        self.lock = threading.Lock()

    def detect(self, data: bytes) -> list[dict]:
        """사진 → [{"organ", "score", "points"}] (points는 0~1 비율)."""
        import numpy as np

        img = Image.open(io.BytesIO(data)).convert("RGB")
        img.thumbnail((self.size, self.size))
        w, h = img.size
        x = np.asarray(img, dtype=np.float32).transpose(2, 0, 1) / 255.0
        with self.lock:  # onnxruntime 세션은 스레드 안전하지만 CPU를 나눠 쓰지 않게 한 번에 하나
            outs = self.session.run(None, {self.input_name: x})
        named = dict(zip(self.output_names, outs))
        boxes = named.get("boxes", outs[0])
        labels = named.get("labels", outs[1])
        scores = named.get("scores", outs[2])
        masks = named.get("masks", outs[3] if len(outs) > 3 else None)
        found: list[dict] = []
        for i in range(len(scores)):
            s = float(scores[i])
            k = int(labels[i])
            if s < self.threshold or k < 1 or k > len(self.classes):
                continue
            pts = mask_polygon(masks[i][0] > 0.5) if masks is not None else None
            if not pts:
                pts = box_polygon(boxes[i], w, h)
            else:
                pts = [[round(px / w, 4), round(py / h, 4)] for px, py in pts]
            found.append({"organ": self.classes[k - 1], "score": round(s, 3), "points": pts})
        # 같은 장기가 여러 번 잡히면 점수 높은 것 3개까지만
        found.sort(key=lambda r: -r["score"])
        per: dict[str, int] = {}
        out = []
        for r in found:
            per[r["organ"]] = per.get(r["organ"], 0) + 1
            if per[r["organ"]] <= 3:
                out.append(r)
        return out


@lru_cache(maxsize=1)
def _load(path: str, mtime: float) -> Detector | None:
    p = Path(path)
    meta_path = p.with_suffix(".json")
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        det = Detector(p, meta)
        log.info("장기 인식 모델 %s 불러옴 (%d개 장기)", det.version, len(det.classes))
        return det
    except ImportError:
        log.warning("onnxruntime이 없어 장기 자동 인식을 끕니다 (pip install onnxruntime numpy)")
    except Exception:  # noqa: BLE001 — 모델이 깨졌어도 서버는 떠야 한다
        log.exception("장기 인식 모델을 불러오지 못했습니다: %s", p)
    return None


def get_detector() -> Detector | None:
    path = Path(os.environ.get("VISION_MODEL") or DEFAULT_MODEL)
    if not path.exists():
        return None
    return _load(str(path), path.stat().st_mtime)


def status() -> dict:
    det = get_detector()
    if not det:
        return {"enabled": False, "version": None, "classes": []}
    return {"enabled": True, "version": det.version, "classes": det.classes}


def apply_auto(db, photo, det: Detector | None = None) -> int:
    """사진 하나에 모델 제안을 붙인다. 이전 '제안'만 지우고 수의사가 확인한 영역은 그대로 둔다."""
    from ..models import PhotoRegion
    from ..storage import storage

    det = det or get_detector()
    if not det:
        return 0
    try:
        regions = det.detect(storage.get(photo.key))
    except Exception:  # noqa: BLE001
        log.exception("사진 %s 자동 인식 실패", photo.id)
        return 0
    db.query(PhotoRegion).filter(PhotoRegion.photo_id == photo.id, PhotoRegion.status == "suggested").delete()
    confirmed = {r.organ for r in db.query(PhotoRegion).filter(PhotoRegion.photo_id == photo.id, PhotoRegion.status == "confirmed")}
    n = 0
    for r in regions:
        if r["organ"] in confirmed:
            continue
        db.add(PhotoRegion(photo_id=photo.id, organ=r["organ"], points=r["points"], score=r["score"], source="auto",
                           status="suggested", model=det.version, lesions=[]))
        n += 1
    photo.auto_model = det.version
    photo.auto_at = dt.datetime.now(dt.UTC).replace(tzinfo=None)
    return n


def run_background(photo_ids: list[int]) -> None:
    """올린 사진들을 뒤에서 자동 인식 (요청은 바로 끝난다)."""
    if not photo_ids or not get_detector():
        return

    def work():
        from ..db import SessionLocal
        from ..models import CasePhoto

        db = SessionLocal()
        try:
            for pid in photo_ids:
                p = db.get(CasePhoto, pid)
                if p and p.label_status != "done":
                    apply_auto(db, p)
                    db.commit()
        finally:
            db.close()

    threading.Thread(target=work, daemon=True).start()
