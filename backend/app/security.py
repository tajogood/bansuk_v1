"""PIN 로그인과 토큰.

농장주는 휴대폰 번호 + 4~6자리 PIN으로 한 번 로그인하면 토큰이 기기에 남아
다시 로그인하지 않는다 (현장에서 매일 쓰는 화면이라 로그인 단계를 없앤다).
"""
import hashlib
import hmac
import os
import secrets

from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from .db import get_db
from .models import AuthToken, User, UserFarm

_ITER = 200_000
BANSUK_ROLES = {"bansuk_vet", "bansuk_staff", "admin"}


def hash_pin(pin: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", pin.encode(), salt, _ITER)
    return f"pbkdf2${_ITER}${salt.hex()}${dk.hex()}"


def verify_pin(pin: str, stored: str) -> bool:
    try:
        _, iters, salt_hex, dk_hex = stored.split("$")
        dk = hashlib.pbkdf2_hmac("sha256", pin.encode(), bytes.fromhex(salt_hex), int(iters))
        return hmac.compare_digest(dk.hex(), dk_hex)
    except ValueError:
        return False


def normalize_phone(phone: str) -> str:
    return "".join(ch for ch in phone if ch.isdigit())


def issue_token(db: Session, user: User) -> str:
    token = secrets.token_hex(32)
    db.add(AuthToken(token=token, user_id=user.id))
    db.commit()
    return token


def current_user(
    authorization: str | None = Header(default=None), db: Session = Depends(get_db)
) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "로그인이 필요합니다")
    token = authorization.split(" ", 1)[1].strip()
    row = db.get(AuthToken, token)
    if not row:
        raise HTTPException(401, "로그인이 만료되었습니다")
    user = db.get(User, row.user_id)
    if not user or not user.active:
        raise HTTPException(401, "사용할 수 없는 계정입니다")
    return user


def accessible_farm_ids(db: Session, user: User) -> set[int] | None:
    """None이면 전체 농장 접근 (반석 직원)."""
    if user.role in BANSUK_ROLES:
        return None
    return {r.farm_id for r in db.query(UserFarm).filter(UserFarm.user_id == user.id)}


def require_farm(db: Session, user: User, farm_id: int) -> None:
    ids = accessible_farm_ids(db, user)
    if ids is not None and farm_id not in ids:
        raise HTTPException(403, "이 농장에 대한 권한이 없습니다")
