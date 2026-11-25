"""반석 데이터 분석기 API (반석 계정 전용).

GET    /api/analysis/catalog            지표·축·묶음 목록
POST   /api/analysis/query              쿼리 실행 → 시리즈
GET    /api/analysis/dashboards         내 대시보드 + 공유 대시보드
POST   /api/analysis/dashboards         만들기
PUT    /api/analysis/dashboards/{id}    고치기 (이름·공유·위젯)
DELETE /api/analysis/dashboards/{id}    지우기
"""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import AnalysisDashboard, User
from ..security import BANSUK_ROLES, current_user
from ..services.explore import catalog, run_query
from ..services.explore_events import catalog as events_catalog
from ..services.explore_events import run_events

router = APIRouter(prefix="/api/analysis", tags=["analysis"])


def bansuk_user(user: User = Depends(current_user)) -> User:
    if user.role not in BANSUK_ROLES:
        raise HTTPException(403, "분석기는 반석 계정에서 사용할 수 있습니다")
    return user


class Query(BaseModel):
    source: Literal["production", "necropsy", "lab"] = "production"
    metric: str = "lay_rate"
    x: str = "date"
    group: str = "flock"
    farm_ids: list[int] = Field(default_factory=list)
    flock_ids: list[int] = Field(default_factory=list)
    house_ids: list[int] = Field(default_factory=list)
    date_from: str | None = None
    date_to: str | None = None
    age_from: int | None = Field(default=None, ge=1)
    age_to: int | None = Field(default=None, ge=1)
    program: Literal["any", "applied", "not"] = "any"
    house_kind: Literal["laying", "rearing", "all"] = "laying"
    smooth: bool = False
    disease: str | None = Field(default=None, max_length=40)  # 부검·검사: 질병 하나만
    antigen: str | None = Field(default=None, max_length=30)  # 검사: 항원 하나만 (평균 역가군)


@router.get("/catalog")
def get_catalog(user: User = Depends(bansuk_user)):
    return {**catalog(), "events": events_catalog()}


@router.post("/query")
def query(q: Query, user: User = Depends(bansuk_user), db: Session = Depends(get_db)):
    try:
        if q.source != "production":
            return run_events(db, q.model_dump(), allowed_farm_ids=None)
        return run_query(db, q.model_dump(), allowed_farm_ids=None)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


class Widget(BaseModel):
    id: str
    title: str = Field(max_length=120)
    chart: Literal["line", "bar", "table"] = "line"
    width: Literal[1, 2] = 1  # 1 = 절반, 2 = 전체 폭
    query: Query
    note: str | None = Field(default=None, max_length=500)


class DashboardIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    shared: bool = False
    widgets: list[Widget] = Field(default_factory=list, max_length=40)


def _out(d: AnalysisDashboard, me: User, db: Session) -> dict:
    owner = db.get(User, d.owner_id)
    return {
        "id": d.id,
        "name": d.name,
        "shared": d.shared,
        "widgets": d.widgets,
        "owner": owner.name if owner else None,
        "mine": d.owner_id == me.id,
        "updated_at": d.updated_at.isoformat() if d.updated_at else None,
    }


@router.get("/dashboards")
def list_dashboards(user: User = Depends(bansuk_user), db: Session = Depends(get_db)):
    rows = (
        db.query(AnalysisDashboard)
        .filter(or_(AnalysisDashboard.owner_id == user.id, AnalysisDashboard.shared.is_(True)))
        .order_by(AnalysisDashboard.updated_at.desc())
        .all()
    )
    return {"dashboards": [_out(d, user, db) for d in rows]}


@router.post("/dashboards")
def create_dashboard(body: DashboardIn, user: User = Depends(bansuk_user), db: Session = Depends(get_db)):
    d = AnalysisDashboard(owner_id=user.id, name=body.name, shared=body.shared,
                          widgets=[w.model_dump() for w in body.widgets])
    db.add(d)
    db.commit()
    db.refresh(d)
    return _out(d, user, db)


def _editable(db: Session, user: User, dash_id: int) -> AnalysisDashboard:
    d = db.get(AnalysisDashboard, dash_id)
    if not d or not (d.owner_id == user.id or d.shared):
        raise HTTPException(404, "대시보드를 찾을 수 없습니다")
    return d


@router.put("/dashboards/{dash_id}")
def update_dashboard(dash_id: int, body: DashboardIn, user: User = Depends(bansuk_user), db: Session = Depends(get_db)):
    d = _editable(db, user, dash_id)
    if d.owner_id != user.id and body.shared is False:
        raise HTTPException(403, "공유 해제는 만든 사람만 할 수 있습니다")
    d.name, d.shared, d.widgets = body.name, body.shared, [w.model_dump() for w in body.widgets]
    db.commit()
    db.refresh(d)
    return _out(d, user, db)


@router.delete("/dashboards/{dash_id}")
def delete_dashboard(dash_id: int, user: User = Depends(bansuk_user), db: Session = Depends(get_db)):
    d = _editable(db, user, dash_id)
    if d.owner_id != user.id:
        raise HTTPException(403, "만든 사람만 지울 수 있습니다")
    db.delete(d)
    db.commit()
    return {"ok": True}
