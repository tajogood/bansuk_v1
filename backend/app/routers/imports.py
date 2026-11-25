"""농장 엑셀 업로드 API.

GET  /api/farms/{farm_id}/imports          이 농장의 양식과 업로드 이력
POST /api/farms/{farm_id}/imports          파일 올리기 → 미리보기 (아직 반영 안 함)
POST /api/imports/{id}/apply               반영
POST /api/imports/{id}/discard             미리보기 취소
POST /api/imports/{id}/revert              반영 되돌리기
GET  /api/imports/{id}/file                올린 원본 파일
"""
from __future__ import annotations

from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ..audit import audit
from ..db import get_db
from ..importers import LABELS
from ..models import Farm, ImportBatch, User
from ..security import current_user, require_farm
from ..services import imports as svc
from ..storage import storage

router = APIRouter(prefix="/api", tags=["imports"])


def _utc(d):
    return d.isoformat(timespec="seconds") + "Z" if d else None


def _batch_dict(db: Session, b: ImportBatch) -> dict:
    names = {u.id: u.name for u in db.query(User.id, User.name).filter(User.id.in_([x for x in (b.uploaded_by, b.reverted_by) if x]))}
    return {
        "id": b.id,
        "status": b.status,
        "filename": b.filename,
        "importer": b.importer,
        "overwrite_manual": b.overwrite_manual,
        "summary": b.summary or {},
        "uploaded_by": names.get(b.uploaded_by),
        "uploaded_at": _utc(b.uploaded_at),
        "applied_at": _utc(b.applied_at),
        "reverted_at": _utc(b.reverted_at),
        "reverted_by": names.get(b.reverted_by),
    }


def _batch(db: Session, user: User, batch_id: int) -> ImportBatch:
    b = db.get(ImportBatch, batch_id)
    if not b:
        raise HTTPException(404, "업로드 기록을 찾을 수 없습니다")
    require_farm(db, user, b.farm_id)
    return b


@router.get("/farms/{farm_id}/imports")
def list_imports(farm_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require_farm(db, user, farm_id)
    farm = db.get(Farm, farm_id)
    batches = db.query(ImportBatch).filter(ImportBatch.farm_id == farm_id).order_by(ImportBatch.id.desc()).limit(50).all()
    return {
        "importer": {"code": farm.importer, "label": LABELS.get(farm.importer, farm.importer)} if farm and farm.importer else None,
        "batches": [_batch_dict(db, b) for b in batches],
    }


@router.post("/farms/{farm_id}/imports")
async def upload(
    farm_id: int,
    file: UploadFile = File(...),
    overwrite_manual: bool = Form(False),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    require_farm(db, user, farm_id)
    farm = db.get(Farm, farm_id)
    if not farm:
        raise HTTPException(404, "농장을 찾을 수 없습니다")
    data = await file.read()
    try:
        b = svc.create_preview(db, farm, data, file.filename or "upload.xlsx", user.id, overwrite_manual)
    except svc.ImportError_ as e:
        raise HTTPException(400, str(e)) from e
    return _batch_dict(db, b)


@router.post("/imports/{batch_id}/apply")
def apply(batch_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    b = _batch(db, user, batch_id)
    try:
        svc.apply(db, b, user.id)
    except svc.ImportError_ as e:
        raise HTTPException(400, str(e)) from e
    audit(db, user.id, "import_applied", target_farm_id=b.farm_id, detail={"batch": b.id, **b.summary.get("applied", {})})
    db.commit()
    return _batch_dict(db, b)


@router.post("/imports/{batch_id}/discard")
def discard(batch_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    b = _batch(db, user, batch_id)
    if b.status != "preview":
        raise HTTPException(400, "이미 처리한 업로드입니다")
    b.status = "discarded"
    db.commit()
    return _batch_dict(db, b)


@router.post("/imports/{batch_id}/revert")
def revert(batch_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    b = _batch(db, user, batch_id)
    try:
        svc.revert(db, b, user.id)
    except svc.ImportError_ as e:
        raise HTTPException(400, str(e)) from e
    audit(db, user.id, "import_reverted", target_farm_id=b.farm_id, detail={"batch": b.id})
    db.commit()
    return _batch_dict(db, b)


@router.get("/imports/{batch_id}/file")
def original(batch_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    b = _batch(db, user, batch_id)
    return Response(
        storage.get(b.file_key),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(b.filename)}"},
    )
