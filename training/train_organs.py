"""반석 부검 사진 장기 인식 모델 학습 → ONNX 내보내기.

반석 시스템의 '사진 태깅' 화면에서 받은 학습 데이터(zip)로 Mask R-CNN을 학습하고,
서버가 바로 쓸 수 있는 organs.onnx + organs.json 을 만든다.

어디서 돌리나: GPU가 있는 PC나 무료 Google Colab (서버에서 돌릴 필요 없음).
    pip install torch torchvision onnx pillow numpy
    python train_organs.py bansuk-necropsy-labels-20270101.zip --epochs 30 --out out/

끝나면 out/organs.onnx, out/organs.json 을 서버의 backend/data/models/ 에 넣고 ./start.sh.
(또는 VISION_MODEL=/경로/organs.onnx). 그 뒤 태깅 화면에서 '태깅 안 한 사진 자동 표시'를 누른다.

라이선스: torchvision(BSD-3) Mask R-CNN, 사전학습 가중치는 COCO (torchvision 배포). 상업 사용 가능.
"""
from __future__ import annotations

import argparse
import datetime as dt
import io
import json
import math
import random
import zipfile
from pathlib import Path

import numpy as np
import torch
import torchvision
from PIL import Image, ImageDraw
from torchvision.models.detection import maskrcnn_resnet50_fpn_v2
from torchvision.models.detection.faster_rcnn import FastRCNNPredictor
from torchvision.models.detection.mask_rcnn import MaskRCNNPredictor
from torchvision.transforms import functional as F

INPUT_SIZE = 800  # 서버 추론 때 긴 변 (organs.json 에 기록)


class LabelZip(torch.utils.data.Dataset):
    """태깅 화면에서 내보낸 zip (dataset.json + images/)."""

    def __init__(self, zpath: Path, ids: list[int], classes: list[str], train: bool):
        self.z = zipfile.ZipFile(zpath)
        ds = json.loads(self.z.read("dataset.json"))
        self.items = [im for im in ds["images"] if im["id"] in set(ids)]
        self.classes = classes
        self.train = train

    def __len__(self):
        return len(self.items)

    def __getitem__(self, i):
        im = self.items[i]
        img = Image.open(io.BytesIO(self.z.read(im["file"]))).convert("RGB")
        img.thumbnail((INPUT_SIZE, INPUT_SIZE))
        w, h = img.size
        boxes, labels, masks = [], [], []
        for r in im["regions"]:
            if r["organ"] not in self.classes:
                continue
            poly = [(x * w, y * h) for x, y in r["points"]]
            m = Image.new("L", (w, h), 0)
            ImageDraw.Draw(m).polygon(poly, fill=1)
            m = np.array(m, dtype=np.uint8)
            if m.sum() < 16:
                continue
            ys, xs = np.nonzero(m)
            boxes.append([xs.min(), ys.min(), xs.max() + 1, ys.max() + 1])
            labels.append(self.classes.index(r["organ"]) + 1)
            masks.append(m)
        t = F.to_tensor(img)
        target = {
            "boxes": torch.tensor(boxes, dtype=torch.float32).reshape(-1, 4),
            "labels": torch.tensor(labels, dtype=torch.int64),
            "masks": torch.tensor(np.stack(masks) if masks else np.zeros((0, h, w), np.uint8)),
        }
        if self.train:
            if random.random() < 0.5:  # 좌우 뒤집기
                t = t.flip(-1)
                b = target["boxes"].clone()
                target["boxes"][:, 0], target["boxes"][:, 2] = w - b[:, 2], w - b[:, 0]
                target["masks"] = target["masks"].flip(-1)
            t = F.adjust_brightness(t, random.uniform(0.8, 1.2))  # 조명 차이
            t = F.adjust_saturation(t, random.uniform(0.8, 1.2))
        return t, target


def build_model(n_classes: int, pretrained: bool):
    model = maskrcnn_resnet50_fpn_v2(weights="DEFAULT" if pretrained else None, min_size=INPUT_SIZE, max_size=INPUT_SIZE)
    inf = model.roi_heads.box_predictor.cls_score.in_features
    model.roi_heads.box_predictor = FastRCNNPredictor(inf, n_classes + 1)
    inm = model.roi_heads.mask_predictor.conv5_mask.in_channels
    model.roi_heads.mask_predictor = MaskRCNNPredictor(inm, 256, n_classes + 1)
    return model


def iou(a: np.ndarray, b: np.ndarray) -> float:
    inter = np.logical_and(a, b).sum()
    union = np.logical_or(a, b).sum()
    return float(inter / union) if union else 0.0


@torch.no_grad()
def evaluate(model, data, classes, device) -> dict:
    """장기별: 찾은 비율(재현율, IoU 0.5 이상)과 평균 IoU. 수의사가 이해하기 쉬운 숫자만."""
    model.eval()
    hit = {c: 0 for c in classes}
    total = {c: 0 for c in classes}
    ious = {c: [] for c in classes}
    for img, tgt in data:
        out = model([img.to(device)])[0]
        pm = (out["masks"][:, 0] > 0.5).cpu().numpy()
        pl = out["labels"].cpu().numpy()
        ps = out["scores"].cpu().numpy()
        for m, lab in zip(tgt["masks"].numpy().astype(bool), tgt["labels"].numpy()):
            c = classes[lab - 1]
            total[c] += 1
            cand = [iou(m, pm[j]) for j in range(len(pl)) if pl[j] == lab and ps[j] >= 0.5]
            best = max(cand, default=0.0)
            ious[c].append(best)
            hit[c] += best >= 0.5
    return {c: {"n": total[c], "found": round(hit[c] / total[c], 2) if total[c] else None,
                "iou": round(float(np.mean(ious[c])), 2) if ious[c] else None} for c in classes}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("zip", type=Path)
    ap.add_argument("--epochs", type=int, default=30)
    ap.add_argument("--out", type=Path, default=Path("out"))
    ap.add_argument("--min-regions", type=int, default=20, help="이보다 적게 태깅된 장기는 학습에서 뺀다")
    ap.add_argument("--val", type=float, default=0.15)
    ap.add_argument("--lr", type=float, default=0.005)
    ap.add_argument("--no-pretrained", action="store_true", help="COCO 사전학습 가중치 없이 (시험용)")
    ap.add_argument("--threshold", type=float, default=0.5)
    args = ap.parse_args()

    ds = json.loads(zipfile.ZipFile(args.zip).read("dataset.json"))
    counts: dict[str, int] = {}
    for im in ds["images"]:
        for r in im["regions"]:
            counts[r["organ"]] = counts.get(r["organ"], 0) + 1
    classes = [c for c in ds["classes"] if counts.get(c, 0) >= args.min_regions]
    skipped = {c: counts.get(c, 0) for c in ds["classes"] if c not in classes}
    print("학습할 장기:", {c: counts[c] for c in classes})
    if skipped:
        print("데이터가 적어 뺀 장기:", skipped)
    if not classes:
        raise SystemExit("학습할 장기가 없습니다. 태깅을 더 해 주세요.")

    ids = [im["id"] for im in ds["images"] if im["regions"]]
    random.Random(42).shuffle(ids)
    n_val = max(1, int(len(ids) * args.val))
    val_ids, train_ids = ids[:n_val], ids[n_val:]
    train = LabelZip(args.zip, train_ids, classes, True)
    val = LabelZip(args.zip, val_ids, classes, False)
    loader = torch.utils.data.DataLoader(train, batch_size=2, shuffle=True, collate_fn=lambda b: tuple(zip(*b)))

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"사진 학습 {len(train)}장, 검증 {len(val)}장, 장치 {device}")
    model = build_model(len(classes), not args.no_pretrained).to(device)
    params = [p for p in model.parameters() if p.requires_grad]
    opt = torch.optim.SGD(params, lr=args.lr, momentum=0.9, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda e: 0.5 * (1 + math.cos(math.pi * e / args.epochs)))

    for epoch in range(args.epochs):
        model.train()
        total = 0.0
        for imgs, tgts in loader:
            imgs = [i.to(device) for i in imgs]
            tgts = [{k: v.to(device) for k, v in t.items()} for t in tgts]
            loss = sum(model(imgs, tgts).values())
            opt.zero_grad()
            loss.backward()
            opt.step()
            total += float(loss)
        sched.step()
        print(f"epoch {epoch + 1}/{args.epochs} loss {total / max(1, len(loader)):.3f}")

    report = evaluate(model, val, classes, device)
    print("검증 결과 (found = 수의사 영역과 절반 이상 겹치게 찾은 비율):")
    for c, r in report.items():
        print(f"  {c:16s} 영역 {r['n']:3d}  찾음 {r['found']}  평균 IoU {r['iou']}")

    args.out.mkdir(parents=True, exist_ok=True)
    model.eval().cpu()
    dummy = [torch.rand(3, INPUT_SIZE, int(INPUT_SIZE * 0.75))]
    onnx_path = args.out / "organs.onnx"
    torch.onnx.export(
        model, (dummy,), str(onnx_path), opset_version=17,
        input_names=["images"], output_names=["boxes", "labels", "scores", "masks"],
        dynamic_axes={"images": [1, 2], "boxes": [0], "labels": [0], "scores": [0], "masks": [0, 2, 3]},
    )
    version = f"organs-{dt.date.today():%Y%m%d}"
    meta = {"version": version, "classes": classes, "input_size": INPUT_SIZE, "score_threshold": args.threshold,
            "trained_on": {"images": len(train), "val": len(val), "regions": {c: counts[c] for c in classes}},
            "validation": report, "torchvision": torchvision.__version__}
    (args.out / "organs.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"완료: {onnx_path} , {args.out / 'organs.json'} (버전 {version})")


if __name__ == "__main__":
    main()
