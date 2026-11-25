from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import AuthToken, Farm, User
from ..schemas import LoginIn
from ..security import accessible_farm_ids, current_user, issue_token, normalize_phone, verify_pin

router = APIRouter(prefix="/api", tags=["auth"])


def _farms_for(db: Session, user: User) -> list[dict]:
    ids = accessible_farm_ids(db, user)
    q = db.query(Farm).filter(Farm.active.is_(True))
    if ids is not None:
        q = q.filter(Farm.id.in_(ids))
    return [{"id": f.id, "name": f.name, "region": f.region} for f in q.order_by(Farm.name)]


@router.post("/auth/login")
def login(body: LoginIn, db: Session = Depends(get_db)):
    user = db.query(User).filter_by(phone=normalize_phone(body.phone), active=True).one_or_none()
    if not user or not verify_pin(body.pin, user.pin_hash):
        raise HTTPException(401, "전화번호 또는 PIN이 맞지 않습니다")
    token = issue_token(db, user)
    return {
        "token": token,
        "user": {"id": user.id, "name": user.name, "role": user.role},
        "farms": _farms_for(db, user),
    }


@router.get("/me")
def me(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return {
        "user": {"id": user.id, "name": user.name, "role": user.role},
        "farms": _farms_for(db, user),
    }


@router.post("/auth/logout")
def logout(user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.query(AuthToken).filter_by(user_id=user.id).delete()
    db.commit()
    return {"ok": True}
