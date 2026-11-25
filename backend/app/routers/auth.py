import datetime as dt

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..audit import audit
from ..db import get_db
from ..models import Farm, User
from ..schemas import LoginIn
from ..security import (
    LOCK_MINUTES,
    MAX_FAILS,
    ROLE_LABELS,
    accessible_farm_ids,
    check_new_pin,
    find_user_by_phone,
    hash_pin,
    issue_token,
    now,
    pin_rule,
    revoke_tokens,
    session_user,
    verify_pin,
)

router = APIRouter(prefix="/api", tags=["auth"])
_DUMMY = hash_pin("timing-equalizer")
_BAD = "휴대폰 번호 또는 비밀번호가 맞지 않습니다"


def _farms_for(db: Session, user: User) -> list[dict]:
    ids = accessible_farm_ids(db, user)
    q = db.query(Farm).filter(Farm.active.is_(True))
    if ids is not None:
        q = q.filter(Farm.id.in_(ids))
    return [{"id": f.id, "name": f.name, "region": f.region} for f in q.order_by(Farm.name)]


def _me(db: Session, user: User) -> dict:
    return {
        "user": {
            "id": user.id,
            "name": user.name,
            "role": user.role,
            "role_label": ROLE_LABELS.get(user.role, user.role),
            "must_change_pin": user.must_change_pin,
            "pin_rule": pin_rule(user.role),
        },
        "farms": [] if user.must_change_pin else _farms_for(db, user),
    }


@router.post("/auth/login")
def login(body: LoginIn, db: Session = Depends(get_db)):
    user = find_user_by_phone(db, body.phone)
    if not user or not user.active:
        verify_pin(body.pin, _DUMMY)  # 없는 번호도 같은 시간이 걸리게
        raise HTTPException(401, _BAD)
    t = now()
    if user.locked_until and user.locked_until > t:
        mins = max(1, int((user.locked_until - t).total_seconds() // 60) + 1)
        raise HTTPException(423, f"비밀번호를 여러 번 틀려 잠시 잠겼습니다. {mins}분 뒤에 다시 해 주세요")
    if not verify_pin(body.pin, user.pin_hash):
        user.failed_count += 1
        if user.failed_count >= MAX_FAILS:
            user.locked_until = t + dt.timedelta(minutes=LOCK_MINUTES)
            user.failed_count = 0
            audit(db, None, "login_locked", target_user_id=user.id)
            db.commit()
            raise HTTPException(423, f"비밀번호를 {MAX_FAILS}번 틀려 {LOCK_MINUTES}분 동안 잠겼습니다")
        db.commit()
        raise HTTPException(401, _BAD)
    if user.must_change_pin and user.temp_expires_at and user.temp_expires_at < t:
        raise HTTPException(401, "임시 비밀번호 기한이 지났습니다. 반석 관리자에게 다시 받아 주세요")
    user.failed_count = 0
    user.locked_until = None
    user.last_login_at = t
    db.commit()
    return {"token": issue_token(db, user), **_me(db, user)}


@router.get("/me")
def me(user: User = Depends(session_user), db: Session = Depends(get_db)):
    return _me(db, user)


class ChangePinIn(BaseModel):
    current: str = Field(min_length=1, max_length=128)
    new: str = Field(min_length=1, max_length=128)


@router.post("/auth/change-pin")
def change_pin(
    body: ChangePinIn,
    user: User = Depends(session_user),
    db: Session = Depends(get_db),
    authorization: str | None = Header(default=None),
):
    if not verify_pin(body.current, user.pin_hash):
        raise HTTPException(400, "지금 비밀번호가 맞지 않습니다")
    reason = check_new_pin(user, body.new)
    if reason:
        raise HTTPException(400, reason)
    first = user.must_change_pin
    user.pin_hash = hash_pin(body.new)
    user.must_change_pin = False
    user.temp_expires_at = None
    user.pin_changed_at = now()
    # 다른 기기의 로그인은 끊고 지금 기기만 유지
    revoke_tokens(db, user.id, keep=authorization.split(" ", 1)[1].strip() if authorization else None)
    audit(db, user.id, "pin_set" if first else "pin_changed", target_user_id=user.id)
    db.commit()
    return _me(db, user)


@router.post("/auth/logout")
def logout(user: User = Depends(session_user), db: Session = Depends(get_db)):
    revoke_tokens(db, user.id)
    db.commit()
    return {"ok": True}
