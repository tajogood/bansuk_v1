"""로그인, 비밀번호, 토큰, 권한.

- 계정은 반석 관리자가 만든다. 만들 때 쉬운 임시 비밀번호(숫자 6자리)를 주고,
  첫 로그인에서 본인이 새 비밀번호를 정해야 다른 화면을 쓸 수 있다.
- 농장 계정 비밀번호는 숫자 6자리 (현장에서 휴대폰 숫자 키패드로 넣는다).
  반석 계정은 영문과 숫자를 섞은 8자 이상.
- 비밀번호는 scrypt 해시만 저장. 토큰은 SHA-256 값만 저장.
- 5번 연속 틀리면 10분 잠금.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import os
import re
import secrets

from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from .crypto import blind_index
from .db import get_db
from .models import AuthToken, User, UserFarm

BANSUK_ROLES = {"bansuk_vet", "bansuk_staff", "admin"}
ROLE_LABELS = {
    "admin": "반석 관리자",
    "bansuk_vet": "수의사·연구원",
    "bansuk_staff": "반석 직원",
    "farm_owner": "농장",
}
MAX_FAILS = 5
LOCK_MINUTES = 10
TEMP_PIN_DAYS = 7
TOKEN_DAYS = {"farm_owner": 180}  # 농장 휴대폰은 오래 유지
TOKEN_DAYS_DEFAULT = 30

_N, _R, _P = 2**14, 8, 1


def now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)


# ---------- 비밀번호 ----------

def hash_pin(pin: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.scrypt(pin.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32)
    return f"scrypt${_N}${_R}${_P}${salt.hex()}${dk.hex()}"


def verify_pin(pin: str, stored: str) -> bool:
    try:
        parts = stored.split("$")
        if parts[0] == "scrypt":
            _, n, r, p, salt_hex, dk_hex = parts
            dk = hashlib.scrypt(pin.encode(), salt=bytes.fromhex(salt_hex), n=int(n), r=int(r), p=int(p), dklen=32)
        elif parts[0] == "pbkdf2":  # 이전 형식
            _, iters, salt_hex, dk_hex = parts
            dk = hashlib.pbkdf2_hmac("sha256", pin.encode(), bytes.fromhex(salt_hex), int(iters))
        else:
            return False
        return hmac.compare_digest(dk.hex(), dk_hex)
    except (ValueError, TypeError):
        return False


def temp_pin() -> str:
    """임시 비밀번호: 전화로 불러주기 쉬운 숫자 6자리 (너무 단순한 것은 피함)."""
    while True:
        p = f"{secrets.randbelow(10**6):06d}"
        if not _too_simple_digits(p):
            return p


def _too_simple_digits(p: str) -> bool:
    if len(set(p)) <= 2:
        return True
    diffs = {(int(b) - int(a)) % 10 for a, b in zip(p, p[1:])}
    return len(diffs) == 1  # 123456, 987654 같은 연속


def pin_rule(role: str) -> dict:
    if role in BANSUK_ROLES:
        return {"kind": "password", "text": "영문과 숫자를 섞어 8자 이상"}
    return {"kind": "digits6", "text": "숫자 6자리"}


def check_new_pin(user: User, new: str) -> str | None:
    """새 비밀번호가 규칙에 맞지 않으면 이유를 돌려준다."""
    if user.role in BANSUK_ROLES:
        if len(new) < 8 or not re.search(r"[A-Za-z]", new) or not re.search(r"\d", new):
            return "영문과 숫자를 섞어 8자 이상으로 정해 주세요"
        if user.phone[-4:] in new:
            return "휴대폰 번호 뒷자리는 넣지 마세요"
    else:
        if not re.fullmatch(r"\d{6}", new):
            return "숫자 6자리로 정해 주세요"
        if _too_simple_digits(new):
            return "같은 숫자 반복이나 123456 같은 연속 숫자는 쓸 수 없습니다"
        if new in user.phone:
            return "휴대폰 번호의 일부는 쓸 수 없습니다"
    if verify_pin(new, user.pin_hash):
        return "지금 비밀번호와 다른 것으로 정해 주세요"
    return None


def set_temp_pin(user: User) -> str:
    p = temp_pin()
    user.pin_hash = hash_pin(p)
    user.must_change_pin = True
    user.temp_expires_at = now() + dt.timedelta(days=TEMP_PIN_DAYS)
    user.failed_count = 0
    user.locked_until = None
    return p


# ---------- 번호, 계정 찾기 ----------

def normalize_phone(phone: str) -> str:
    return "".join(ch for ch in phone if ch.isdigit())


def valid_phone(phone: str) -> bool:
    return bool(re.fullmatch(r"01\d{8,9}", normalize_phone(phone)))


def find_user_by_phone(db: Session, phone: str) -> User | None:
    return db.query(User).filter_by(phone_idx=blind_index(normalize_phone(phone))).one_or_none()


# ---------- 토큰 ----------

def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def issue_token(db: Session, user: User) -> str:
    token = secrets.token_urlsafe(32)
    days = TOKEN_DAYS.get(user.role, TOKEN_DAYS_DEFAULT)
    db.add(AuthToken(token_hash=_token_hash(token), user_id=user.id, expires_at=now() + dt.timedelta(days=days)))
    db.commit()
    return token


def revoke_tokens(db: Session, user_id: int, keep: str | None = None) -> None:
    q = db.query(AuthToken).filter(AuthToken.user_id == user_id)
    if keep:
        q = q.filter(AuthToken.token_hash != _token_hash(keep))
    q.delete(synchronize_session=False)


def _bearer(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "로그인이 필요합니다")
    return authorization.split(" ", 1)[1].strip()


def session_user(authorization: str | None = Header(default=None), db: Session = Depends(get_db)) -> User:
    """로그인만 확인 (비밀번호 바꾸기 전에도 쓸 수 있는 곳: 내 정보, 비밀번호 변경, 로그아웃)."""
    row = db.get(AuthToken, _token_hash(_bearer(authorization)))
    if not row or row.expires_at < now():
        raise HTTPException(401, "로그인이 만료되었습니다. 다시 로그인해 주세요")
    user = db.get(User, row.user_id)
    if not user or not user.active:
        raise HTTPException(401, "사용할 수 없는 계정입니다")
    return user


def current_user(user: User = Depends(session_user)) -> User:
    """일반 화면용: 임시 비밀번호 상태면 막는다."""
    if user.must_change_pin:
        raise HTTPException(403, detail={"code": "pin_change_required", "message": "새 비밀번호를 정해야 합니다"})
    return user


def admin_user(user: User = Depends(current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(403, "반석 관리자만 쓸 수 있습니다")
    return user


# ---------- 농장 권한 ----------

def accessible_farm_ids(db: Session, user: User) -> set[int] | None:
    """None이면 전체 농장 접근 (반석 직원)."""
    if user.role in BANSUK_ROLES:
        return None
    return {r.farm_id for r in db.query(UserFarm).filter(UserFarm.user_id == user.id)}


def require_farm(db: Session, user: User, farm_id: int) -> None:
    ids = accessible_farm_ids(db, user)
    if ids is not None and farm_id not in ids:
        raise HTTPException(403, "이 농장에 대한 권한이 없습니다")
