"""사진 저장소.

- 개발·단일 서버: 디스크 (STORAGE_DIR, 기본 backend/data/uploads). 저장소에 올라가지 않음.
- 운영(AWS): 같은 인터페이스로 S3 저장소를 붙일 예정 (STORAGE=s3).
- 사진 주소는 공개하지 않는다. 목록 API가 권한을 확인한 뒤 1시간짜리 서명 링크를 준다
  (<img>는 로그인 헤더를 못 보내므로 링크 자체에 서명을 담는다).
"""
from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import io
import os
import secrets
import time
from pathlib import Path

from PIL import ExifTags, Image, ImageOps

from .crypto import _keys

_DIR = Path(os.environ.get("STORAGE_DIR", Path(__file__).resolve().parent.parent / "data" / "uploads"))
MAX_SIDE = 2560  # 원본도 이 크기로 줄여 둔다 (휴대폰 사진 1장 약 1MB)
THUMB_SIDE = 480
LINK_SECONDS = 3600
MAX_UPLOAD_BYTES = 25 * 1024 * 1024


class LocalStorage:
    def __init__(self, root: Path):
        self.root = root

    def put(self, key: str, data: bytes) -> None:
        p = self.root / key
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)

    def get(self, key: str) -> bytes:
        return (self.root / key).read_bytes()

    def delete(self, key: str) -> None:
        (self.root / key).unlink(missing_ok=True)


storage = LocalStorage(_DIR)


def _taken_at(img: Image.Image) -> dt.datetime | None:
    try:
        exif = img.getexif()
        sub = exif.get_ifd(ExifTags.IFD.Exif)
        raw = sub.get(ExifTags.Base.DateTimeOriginal) or exif.get(ExifTags.Base.DateTime)
        return dt.datetime.strptime(str(raw), "%Y:%m:%d %H:%M:%S") if raw else None
    except Exception:  # noqa: BLE001 — 촬영 정보가 없거나 깨진 사진도 받는다
        return None


def save_photo(case_id: int, data: bytes) -> dict:
    """사진을 JPEG로 정리해 원본(최대 2560px)과 썸네일을 저장한다. 위치 정보 등 EXIF는 지운다."""
    if len(data) > MAX_UPLOAD_BYTES:
        raise ValueError("사진 한 장이 너무 큽니다 (25MB 이하)")
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except Exception as e:  # noqa: BLE001
        raise ValueError("사진 파일을 읽을 수 없습니다") from e
    taken = _taken_at(img)
    img = ImageOps.exif_transpose(img).convert("RGB")
    img.thumbnail((MAX_SIDE, MAX_SIDE))
    w, h = img.size
    stem = f"cases/{case_id}/{dt.date.today():%Y%m}/{secrets.token_hex(8)}"
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=88, optimize=True)
    storage.put(f"{stem}.jpg", buf.getvalue())
    th = img.copy()
    th.thumbnail((THUMB_SIDE, THUMB_SIDE))
    buf = io.BytesIO()
    th.save(buf, "JPEG", quality=80, optimize=True)
    storage.put(f"{stem}_t.jpg", buf.getvalue())
    return {"key": f"{stem}.jpg", "thumb_key": f"{stem}_t.jpg", "width": w, "height": h, "taken_at": taken}


def _sig(photo_id: int, size: str, exp: int) -> str:
    msg = f"{photo_id}:{size}:{exp}".encode()
    return hmac.new(_keys()[1], msg, hashlib.sha256).hexdigest()[:32]


def signed_url(photo_id: int, size: str = "full") -> str:
    exp = int(time.time()) + LINK_SECONDS
    return f"/api/photos/{photo_id}/{size}?exp={exp}&sig={_sig(photo_id, size, exp)}"


def check_sig(photo_id: int, size: str, exp: int, sig: str) -> bool:
    return exp >= time.time() and hmac.compare_digest(_sig(photo_id, size, exp), sig)
