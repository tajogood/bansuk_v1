"""개인정보 암호화.

- 휴대폰 번호 같은 개인정보는 AES-256-GCM으로 암호화해 저장한다.
- 로그인할 때 번호로 계정을 찾아야 하므로, 번호의 HMAC-SHA256 값(블라인드 인덱스)을
  따로 저장해 그것으로 찾는다. DB만 유출되어서는 번호를 알 수 없다.
- 키는 환경변수 BANSUK_DATA_KEY (32바이트를 base64로 인코딩한 값).
  운영(BANSUK_ENV=production)에서 키가 없으면 서버가 뜨지 않는다.
  개발에서는 backend/data/dev-data.key 를 만들어 쓴다 (저장소에 올라가지 않음).
- 키를 잃으면 암호화된 번호를 되살릴 수 없으므로 운영 키는 별도로 보관한다.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
from functools import lru_cache
from pathlib import Path

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

_DEV_KEY = Path(__file__).resolve().parent.parent / "data" / "dev-data.key"
_VERSION = "v1"


def _load_master() -> bytes:
    raw = os.environ.get("BANSUK_DATA_KEY")
    if raw:
        key = base64.b64decode(raw)
        if len(key) != 32:
            raise RuntimeError("BANSUK_DATA_KEY는 32바이트 키를 base64로 인코딩한 값이어야 합니다")
        return key
    if os.environ.get("BANSUK_ENV") == "production":
        raise RuntimeError("운영 환경에는 BANSUK_DATA_KEY가 필요합니다")
    if not _DEV_KEY.exists():
        _DEV_KEY.parent.mkdir(parents=True, exist_ok=True)
        _DEV_KEY.write_bytes(base64.b64encode(os.urandom(32)))
        os.chmod(_DEV_KEY, 0o600)
    return base64.b64decode(_DEV_KEY.read_bytes())


def _derive(master: bytes, info: bytes) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=info).derive(master)


@lru_cache(maxsize=1)
def _keys() -> tuple[bytes, bytes]:
    m = _load_master()
    return _derive(m, b"bansuk-enc"), _derive(m, b"bansuk-index")


def check_key() -> None:
    """서버 시작 시 키를 확인 (운영에서 키가 없으면 여기서 멈춘다)."""
    _keys()


def encrypt(text: str) -> str:
    nonce = os.urandom(12)
    ct = AESGCM(_keys()[0]).encrypt(nonce, text.encode(), None)
    return f"{_VERSION}:{base64.b64encode(nonce + ct).decode()}"


def decrypt(token: str) -> str:
    ver, b64 = token.split(":", 1)
    if ver != _VERSION:
        raise ValueError("알 수 없는 암호문 버전")
    data = base64.b64decode(b64)
    return AESGCM(_keys()[0]).decrypt(data[:12], data[12:], None).decode()


def blind_index(text: str) -> str:
    return hmac.new(_keys()[1], text.encode(), hashlib.sha256).hexdigest()


def generate_key() -> str:
    """운영 키 만들기: python -m app.crypto"""
    return base64.b64encode(os.urandom(32)).decode()


if __name__ == "__main__":
    print(generate_key())
