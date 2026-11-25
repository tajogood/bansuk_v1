"""서버를 처음 띄울 때 반석 관리자 계정을 만든다.

관리자가 한 명도 없을 때만 동작한다. 번호와 이름은 환경변수로 정하고,
임시 비밀번호는 BANSUK_ADMIN_INITIAL_PIN 이 있으면 그것을, 없으면 새로 만들어
서버 로그에 한 번만 출력한다. 첫 로그인에서 새 비밀번호를 정해야 한다.
"""
from __future__ import annotations

import logging
import os

from sqlalchemy.orm import Session

from .audit import audit
from .models import User
from .security import find_user_by_phone, hash_pin, set_temp_pin, valid_phone

log = logging.getLogger("bansuk")


def ensure_admin(db: Session) -> str | None:
    if db.query(User).filter(User.role == "admin", User.active.is_(True)).first():
        return None
    phone = os.environ.get("BANSUK_ADMIN_PHONE", "010-9999-9999")
    name = os.environ.get("BANSUK_ADMIN_NAME", "반석 관리자")
    if not valid_phone(phone):
        raise RuntimeError("BANSUK_ADMIN_PHONE 형식이 맞지 않습니다")
    u = find_user_by_phone(db, phone)
    if u:  # 같은 번호의 계정이 있으면 관리자로 올림
        u.role, u.active = "admin", True
    else:
        u = User(name=name, role="admin")
        u.set_phone(phone)
        db.add(u)
    temp = set_temp_pin(u)
    given = os.environ.get("BANSUK_ADMIN_INITIAL_PIN")
    if given:
        u.pin_hash = hash_pin(given)
        temp = None
    db.flush()
    audit(db, None, "admin_bootstrap", target_user_id=u.id)
    db.commit()
    msg = f"반석 관리자 계정을 만들었습니다: {phone}"
    msg += f", 임시 비밀번호 {temp} (첫 로그인 때 바꿔야 함)" if temp else " (임시 비밀번호는 BANSUK_ADMIN_INITIAL_PIN)"
    log.warning(msg)
    print(msg, flush=True)
    return temp
