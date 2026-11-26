"""접종 알림 (앱 안 종 알림).

서버가 떠 있는 동안 30분마다 돌고, 같은 알림은 dedupe_key로 한 번만 보낸다. 몇 번 돌아도 결과가 같다.

농장주 (그 농장 계정)
    vaccination_soon    접종 예정일 SOON_DAYS일 전부터 (예정일마다 한 번)
    vaccination_overdue 예정일이 지났는데 기록이 없을 때 (한 번, 최근 OVERDUE_DAYS일 안의 것만)
반석 (수의사·직원·관리자)
    vaccination_week    월요일(그 주 처음 돌 때) 이번 주 접종 예정 요약 (주마다 한 번)
    vaccination_overdue 밀린 접종 (항목마다 한 번)
"""
from __future__ import annotations

import asyncio
import datetime as dt
import logging
import os

from sqlalchemy.orm import Session

from ..models import Farm, Flock, FlockLocation, FlockProgram, House, Notification, User, UserFarm
from ..security import BANSUK_ROLES
from . import vaccines as vsvc

log = logging.getLogger("bansuk.reminders")

SOON_DAYS = 3
OVERDUE_DAYS = 14
INTERVAL_SECONDS = 30 * 60


def _sent(db: Session, user_id: int, key: str) -> bool:
    return db.query(Notification.id).filter(Notification.user_id == user_id, Notification.dedupe_key == key).first() is not None


def _send(db: Session, user_ids: list[int], kind: str, key: str, data: dict) -> int:
    n = 0
    for uid in user_ids:
        if not _sent(db, uid, key):
            db.add(Notification(user_id=uid, kind=kind, dedupe_key=key[:80], data=data))
            n += 1
    return n


def run(db: Session, today: dt.date | None = None) -> int:
    """보낸 알림 수를 돌려준다."""
    today = today or vsvc.local_today()
    bansuk = [u.id for u in db.query(User).filter(User.role.in_(BANSUK_ROLES), User.active.is_(True))]
    owners: dict[int, list[int]] = {}
    for uid, fid in (
        db.query(UserFarm.user_id, UserFarm.farm_id)
        .join(User, User.id == UserFarm.user_id)
        .filter(User.role == "farm_owner", User.active.is_(True))
    ):
        owners.setdefault(fid, []).append(uid)
    farms = {f.id: f for f in db.query(Farm)}
    flock_ids = {fid for (fid,) in db.query(FlockProgram.flock_id).distinct()}
    sent = 0
    week_items: list[dict] = []
    week_start = today - dt.timedelta(days=today.weekday())
    week_end = week_start + dt.timedelta(days=6)
    for flock in db.query(Flock).filter(Flock.id.in_(flock_ids or [-1]), Flock.status != "closed"):
        loc = db.query(FlockLocation).filter(FlockLocation.flock_id == flock.id).order_by(FlockLocation.from_date.desc()).first()
        house = db.get(House, loc.house_id) if loc else None
        farm = farms.get(flock.farm_id)
        for s in vsvc.schedule(db, flock, today):
            if s["status"] == "done" or not s["vaccine"]:
                continue
            planned = dt.date.fromisoformat(s["planned"])
            data = {"farm": farm.name if farm else "", "house": house.name if house else "", "flock_id": flock.id,
                    "vaccine": s["vaccine"]["name"], "planned": s["planned"], "age_days": s["age_days"]}
            base = f"{flock.id}:{s['item_id']}:{s['planned']}"
            if today <= planned <= today + dt.timedelta(days=SOON_DAYS):
                sent += _send(db, owners.get(flock.farm_id, []), "vaccination_soon", f"vs:{base}", data)
            if today - dt.timedelta(days=OVERDUE_DAYS) <= planned < today:
                sent += _send(db, owners.get(flock.farm_id, []) + bansuk, "vaccination_overdue", f"vo:{base}", data)
            if week_start <= planned <= week_end:
                week_items.append({**data, "farm_id": flock.farm_id})
    if week_items:
        summary = {"count": len(week_items), "farms": len({i["farm_id"] for i in week_items}),
                   "from": week_start.isoformat(), "to": week_end.isoformat()}
        sent += _send(db, bansuk, "vaccination_week", f"vw:{week_start.isoformat()}", summary)
    db.commit()
    if sent:
        log.info("접종 알림 %d건", sent)
    return sent


def enabled() -> bool:
    return os.environ.get("BANSUK_REMINDERS", "1") not in ("0", "false", "off")


async def loop() -> None:
    """앱이 떠 있는 동안 주기적으로 돈다 (서버 한 대 기준)."""
    from ..db import SessionLocal

    while True:
        try:
            def work():
                with SessionLocal() as db:
                    run(db)

            await asyncio.to_thread(work)
        except Exception:  # noqa: BLE001 — 알림 실패로 서버가 죽으면 안 된다
            log.exception("접종 알림 실패")
        await asyncio.sleep(INTERVAL_SECONDS)
