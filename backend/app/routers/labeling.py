"""부검 사진 태깅 (반석 전용).

수의사가 사진에 장기 영역을 그리고 장기·소견을 붙인 뒤, 사진 단위로 질병을 정한다.
학습한 모델이 있으면 올릴 때 '제안' 영역이 먼저 붙고, 수의사는 맞으면 확인, 틀리면 고친다.
확인된 사진은 학습 데이터로 내보낼 수 있다 (export.zip → scripts/train_organs.py).
"""
from __future__ import annotations

import datetime as dt
import hashlib
import io
import os
import json
import tempfile
import zipfile
from collections import Counter

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
from PIL import Image
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..audit import audit
from ..db import get_db
from ..lab_catalog import DISEASE_LABELS
from ..models import CasePhoto, Farm, House, NecropsyCase, PhotoRegion, User
from ..security import BANSUK_ROLES, current_user
from ..storage import save_photo, signed_url, storage
from ..vision import apply_auto, get_detector, run_background
from ..vision import status as vision_status
from ..vision.labels import LESIONS, ORGANS, TARGET_PER_ORGAN

router = APIRouter(prefix="/api/labeling", tags=["labeling"])

MAX_PER_CALL = 30
EXPORT_SIDE = 1280


def bansuk(user: User = Depends(current_user)) -> User:
    if user.role not in BANSUK_ROLES:
        raise HTTPException(403, "반석 계정만 쓸 수 있습니다")
    return user


def _farm_names(db: Session) -> dict[int, str]:
    return {f.id: f.name for f in db.query(Farm)}


def _date(p: CasePhoto) -> str | None:
    d = p.taken_at or p.uploaded_at
    return d.date().isoformat() if d else None


# ---------- 요약·목록 ----------

@router.get("/summary")
def summary(user: User = Depends(bansuk), db: Session = Depends(get_db)):
    by_status = dict(db.query(CasePhoto.label_status, func.count()).group_by(CasePhoto.label_status).all())
    suggested_photos = (
        db.query(func.count(func.distinct(PhotoRegion.photo_id))).filter(PhotoRegion.status == "suggested").scalar() or 0
    )
    organs = dict(
        db.query(PhotoRegion.organ, func.count())
        .join(CasePhoto, CasePhoto.id == PhotoRegion.photo_id)
        .filter(PhotoRegion.status == "confirmed", CasePhoto.label_status == "done")
        .group_by(PhotoRegion.organ)
        .all()
    )
    diseases: Counter = Counter()
    normal = 0
    for ds, nm in db.query(CasePhoto.diseases, CasePhoto.normal).filter(CasePhoto.label_status == "done"):
        diseases.update(ds or [])
        normal += 1 if nm else 0
    return {
        "total": sum(by_status.values()),
        "todo": by_status.get("todo", 0),
        "done": by_status.get("done", 0),
        "skip": by_status.get("skip", 0),
        "suggested": suggested_photos,
        "organs": [{"organ": o, "count": organs.get(o, 0)} for o in ORGANS],
        "target_per_organ": TARGET_PER_ORGAN,
        "diseases": [{"disease": d, "count": n} for d, n in diseases.most_common()],
        "normal": normal,
        "model": vision_status(),
    }


def _queue(db: Session, status: str, farm_id: int | None = None, organ: str | None = None, disease: str | None = None):
    q = db.query(CasePhoto)
    if status == "suggested":
        ids = db.query(PhotoRegion.photo_id).filter(PhotoRegion.status == "suggested").distinct()
        q = q.filter(CasePhoto.id.in_(ids), CasePhoto.label_status == "todo")
    elif status in ("todo", "done", "skip"):
        q = q.filter(CasePhoto.label_status == status)
    if farm_id:
        q = q.filter(CasePhoto.farm_id == farm_id)
    if organ:
        q = q.filter(CasePhoto.id.in_(db.query(PhotoRegion.photo_id).filter(PhotoRegion.organ == organ)))
    # 오래된 사진부터 (지난 사진을 차례로 정리), 완료 목록은 최근 것부터
    order = CasePhoto.labeled_at.desc() if status == "done" else CasePhoto.id.asc()
    q = q.order_by(order, CasePhoto.id)
    if disease:
        return [p for p in q.all() if disease in (p.diseases or [])]
    return q


@router.get("/photos")
def list_photos(
    status: str = Query("todo"),
    farm_id: int | None = None,
    organ: str | None = None,
    disease: str | None = None,
    limit: int = Query(60, le=200),
    offset: int = Query(0, ge=0),
    user: User = Depends(bansuk),
    db: Session = Depends(get_db),
):
    q = _queue(db, status, farm_id, organ, disease)
    if isinstance(q, list):
        total, photos = len(q), q[offset: offset + limit]
    else:
        total, photos = q.count(), q.offset(offset).limit(limit).all()
    ids = [p.id for p in photos]
    counts: dict[int, Counter] = {}
    if ids:
        for pid, st in db.query(PhotoRegion.photo_id, PhotoRegion.status).filter(PhotoRegion.photo_id.in_(ids)):
            counts.setdefault(pid, Counter())[st] += 1
    farms = _farm_names(db)
    return {
        "total": total,
        "items": [
            {
                "id": p.id, "thumb": signed_url(p.id, "thumb"), "case_id": p.case_id, "source": p.source,
                "farm": farms.get(p.farm_id, "") if p.farm_id else "", "date": _date(p), "status": p.label_status,
                "regions": counts.get(p.id, Counter()).get("confirmed", 0),
                "suggested": counts.get(p.id, Counter()).get("suggested", 0),
                "diseases": p.diseases or [], "normal": p.normal,
            }
            for p in photos
        ],
    }


def _neighbors(db: Session, p: CasePhoto, status: str) -> tuple[int | None, int | None]:
    q = _queue(db, status)
    ids = [x.id for x in q] if isinstance(q, list) else [x for (x,) in q.with_entities(CasePhoto.id)]
    if p.id not in ids:
        return None, ids[0] if ids else None
    i = ids.index(p.id)
    return (ids[i - 1] if i > 0 else None), (ids[i + 1] if i + 1 < len(ids) else None)


def _region(r: PhotoRegion) -> dict:
    return {"id": r.id, "organ": r.organ, "lesions": r.lesions or [], "points": r.points or [], "source": r.source,
            "status": r.status, "score": r.score}


@router.get("/photos/{pid}")
def get_photo(pid: int, queue: str = Query("todo"), user: User = Depends(bansuk), db: Session = Depends(get_db)):
    p = db.get(CasePhoto, pid)
    if not p:
        raise HTTPException(404, "사진을 찾을 수 없습니다")
    prev_id, next_id = _neighbors(db, p, queue)
    case = db.get(NecropsyCase, p.case_id) if p.case_id else None
    house = db.get(House, case.house_id) if case and case.house_id else None
    farm = db.get(Farm, p.farm_id) if p.farm_id else None
    regions = db.query(PhotoRegion).filter(PhotoRegion.photo_id == p.id).order_by(PhotoRegion.id).all()
    return {
        "id": p.id, "url": signed_url(p.id, "full"), "width": p.width, "height": p.height, "source": p.source,
        "date": _date(p), "status": p.label_status, "diseases": p.diseases or [], "normal": p.normal, "note": p.label_note,
        "farm": farm.name if farm else "", "house": house.name if house else "",
        "case": (
            {"id": case.id, "suspected": case.suspected or [], "final_diagnosis": case.final_diagnosis,
             "final_diseases": case.final_diseases or [],
             "summary": case.summary, "findings": case.findings or []}
            if case else None
        ),
        "regions": [_region(r) for r in regions],
        "auto_model": p.auto_model,
        "prev_id": prev_id, "next_id": next_id,
    }


# ---------- 저장 ----------

class RegionIn(BaseModel):
    id: int | None = None
    organ: str
    lesions: list[str] = Field(default_factory=list, max_length=10)
    points: list[list[float]] = Field(min_length=3, max_length=400)
    status: str = "confirmed"  # 제안을 그대로 두고 저장하면 suggested


class LabelIn(BaseModel):
    regions: list[RegionIn] = Field(default_factory=list, max_length=60)
    diseases: list[str] = Field(default_factory=list, max_length=10)
    normal: bool = False
    note: str | None = Field(default=None, max_length=300)
    status: str = "done"  # done | todo (임시 저장) | skip (학습에 안 씀: 흐림 등)


@router.put("/photos/{pid}")
def save_label(pid: int, body: LabelIn, user: User = Depends(bansuk), db: Session = Depends(get_db)):
    p = db.get(CasePhoto, pid)
    if not p:
        raise HTTPException(404, "사진을 찾을 수 없습니다")
    if body.status not in ("done", "todo", "skip"):
        raise HTTPException(400, "저장 상태가 올바르지 않습니다")
    for r in body.regions:
        if r.organ not in ORGANS:
            raise HTTPException(400, "모르는 장기입니다")
        if any(x not in LESIONS for x in r.lesions):
            raise HTTPException(400, "모르는 소견입니다")
        if any(len(pt) != 2 or not (-0.01 <= pt[0] <= 1.01 and -0.01 <= pt[1] <= 1.01) for pt in r.points):
            raise HTTPException(400, "영역 좌표가 올바르지 않습니다")
    if any(d not in DISEASE_LABELS for d in body.diseases):
        raise HTTPException(400, "모르는 질병입니다")
    if body.status == "done" and not body.regions and not body.normal and not body.diseases:
        raise HTTPException(400, "장기 영역을 하나 이상 그리거나, 질병 또는 '이상 없음'을 골라 주세요")
    if body.status == "done" and any(r.status == "suggested" for r in body.regions):
        raise HTTPException(400, "확인하지 않은 자동 표시가 남아 있습니다. 확인하거나 지워 주세요")

    old = {r.id: r for r in db.query(PhotoRegion).filter(PhotoRegion.photo_id == p.id)}
    keep: set[int] = set()
    for r in body.regions:
        pts = [[round(min(1.0, max(0.0, x)), 4), round(min(1.0, max(0.0, y)), 4)] for x, y in r.points]
        st = "suggested" if r.status == "suggested" else "confirmed"
        if r.id and r.id in old:
            o = old[r.id]
            o.organ, o.lesions, o.points, o.status, o.updated_by = r.organ, r.lesions, pts, st, user.id
            keep.add(o.id)
        else:
            db.add(PhotoRegion(photo_id=p.id, organ=r.organ, lesions=r.lesions, points=pts, source="manual",
                               status="confirmed", created_by=user.id, updated_by=user.id))
    for rid, o in old.items():
        if rid not in keep:
            db.delete(o)
    p.diseases = list(dict.fromkeys(body.diseases))
    p.normal = body.normal
    p.label_note = (body.note or "").strip() or None
    p.label_status = body.status
    if body.status != "todo":
        p.labeled_by, p.labeled_at = user.id, dt.datetime.now(dt.UTC).replace(tzinfo=None)
    db.commit()
    return get_photo(pid, "todo", user, db)


@router.post("/photos/{pid}/auto")
def rerun_auto(pid: int, user: User = Depends(bansuk), db: Session = Depends(get_db)):
    det = get_detector()
    if not det:
        raise HTTPException(409, "아직 장기 인식 모델이 없습니다")
    p = db.get(CasePhoto, pid)
    if not p:
        raise HTTPException(404, "사진을 찾을 수 없습니다")
    n = apply_auto(db, p, det)
    db.commit()
    return {"added": n, **get_photo(pid, "todo", user, db)}


@router.post("/auto-pending")
def auto_pending(bg: BackgroundTasks, user: User = Depends(bansuk), db: Session = Depends(get_db)):
    """모델을 새로 넣은 뒤, 아직 태깅 안 한 사진 전체에 자동 표시를 붙인다 (뒤에서 진행)."""
    det = get_detector()
    if not det:
        raise HTTPException(409, "아직 장기 인식 모델이 없습니다")
    ids = [pid for (pid,) in db.query(CasePhoto.id).filter(
        CasePhoto.label_status == "todo", (CasePhoto.auto_model.is_(None)) | (CasePhoto.auto_model != det.version))]
    bg.add_task(run_background, ids)
    return {"queued": len(ids)}


# ---------- 지난 사진 일괄 업로드 ----------

@router.post("/upload")
async def upload_archive(
    files: list[UploadFile] = File(...),
    farm_id: int | None = Form(None),
    user: User = Depends(bansuk),
    db: Session = Depends(get_db),
):
    if len(files) > MAX_PER_CALL:
        raise HTTPException(400, "한 번에 30장까지 올릴 수 있습니다")
    if farm_id and not db.get(Farm, farm_id):
        raise HTTPException(404, "농장을 찾을 수 없습니다")
    saved, dup, failed, new_ids = 0, 0, [], []
    for f in files:
        data = await f.read()
        sha = hashlib.sha256(data).hexdigest()
        if db.query(CasePhoto.id).filter(CasePhoto.sha256 == sha).first():
            dup += 1
            continue
        try:
            info = save_photo("archive", data)
        except ValueError as e:
            failed.append({"name": f.filename, "error": str(e)})
            continue
        p = CasePhoto(case_id=None, source="archive", farm_id=farm_id, stage="archive", uploaded_by=user.id,
                      caption=(f.filename or "")[:200] or None, **info)
        db.add(p)
        db.flush()
        new_ids.append(p.id)
        saved += 1
    if saved:
        audit(db, user.id, "photos_archived", target_farm_id=farm_id, detail={"count": saved})
    db.commit()
    run_background(new_ids)
    return {"saved": saved, "duplicates": dup, "failed": failed, "auto": bool(get_detector())}


# ---------- 학습 데이터 내보내기 ----------

def build_dataset(db: Session, out: zipfile.ZipFile) -> dict:
    """태깅 끝난 사진을 학습용으로 묶는다: images/<id>.jpg + dataset.json (반석 형식) + coco.json."""
    photos = db.query(CasePhoto).filter(CasePhoto.label_status == "done").order_by(CasePhoto.id).all()
    regions: dict[int, list[PhotoRegion]] = {}
    for r in db.query(PhotoRegion).filter(PhotoRegion.status == "confirmed"):
        regions.setdefault(r.photo_id, []).append(r)
    used = sorted({r.organ for rs in regions.values() for r in rs}, key=ORGANS.index)
    ds = {"version": dt.date.today().isoformat(), "classes": used, "lesions": LESIONS,
          "diseases": list(DISEASE_LABELS), "images": []}
    coco = {"images": [], "annotations": [], "categories": [{"id": i + 1, "name": c} for i, c in enumerate(used)]}
    ann_id = 0
    for p in photos:
        img = Image.open(io.BytesIO(storage.get(p.key))).convert("RGB")
        img.thumbnail((EXPORT_SIDE, EXPORT_SIDE))
        w, h = img.size
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=90)
        name = f"images/{p.id}.jpg"
        out.writestr(name, buf.getvalue())
        rs = regions.get(p.id, [])
        ds["images"].append({
            "id": p.id, "file": name, "width": w, "height": h, "diseases": p.diseases or [], "normal": p.normal,
            "regions": [{"organ": r.organ, "lesions": r.lesions or [], "points": r.points} for r in rs],
        })
        coco["images"].append({"id": p.id, "file_name": name, "width": w, "height": h})
        for r in rs:
            ann_id += 1
            poly = [v for x, y in r.points for v in (x * w, y * h)]
            xs, ys = poly[0::2], poly[1::2]
            coco["annotations"].append({
                "id": ann_id, "image_id": p.id, "category_id": used.index(r.organ) + 1, "iscrowd": 0,
                "segmentation": [[round(v, 1) for v in poly]],
                "bbox": [round(min(xs), 1), round(min(ys), 1), round(max(xs) - min(xs), 1), round(max(ys) - min(ys), 1)],
                "area": round(_area(xs, ys), 1),
            })
    out.writestr("dataset.json", json.dumps(ds, ensure_ascii=False, indent=1))
    out.writestr("coco.json", json.dumps(coco, ensure_ascii=False))
    return {"images": len(photos), "regions": ann_id, "classes": used}


def _area(xs: list[float], ys: list[float]) -> float:
    n = len(xs)
    return abs(sum(xs[i] * ys[(i + 1) % n] - xs[(i + 1) % n] * ys[i] for i in range(n))) / 2


@router.get("/export.zip")
def export_zip(user: User = Depends(bansuk), db: Session = Depends(get_db)):
    tmp = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
    try:
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_STORED) as z:
            info = build_dataset(db, z)
    finally:
        tmp.close()
    if not info["images"]:
        os.unlink(tmp.name)
        raise HTTPException(400, "태깅을 마친 사진이 아직 없습니다")
    audit(db, user.id, "labels_exported", detail=info)
    db.commit()
    return FileResponse(tmp.name, media_type="application/zip",
                        filename=f"bansuk-necropsy-labels-{dt.date.today():%Y%m%d}.zip",
                        background=BackgroundTask(os.unlink, tmp.name))


@router.delete("/photos/{pid}")
def delete_archive(pid: int, user: User = Depends(bansuk), db: Session = Depends(get_db)):
    """지난 사진(부검 건 없는 것)만 여기서 지운다. 부검 건 사진은 부검 화면에서."""
    p = db.get(CasePhoto, pid)
    if not p:
        raise HTTPException(404, "사진을 찾을 수 없습니다")
    if p.case_id:
        raise HTTPException(409, "부검 건 사진은 부검 화면에서 지워 주세요")
    storage.delete(p.key)
    storage.delete(p.thumb_key)
    db.query(PhotoRegion).filter(PhotoRegion.photo_id == p.id).delete()
    db.delete(p)
    db.commit()
    return {"ok": True}
