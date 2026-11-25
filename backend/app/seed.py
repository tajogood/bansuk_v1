"""데모용 가상 데이터. 실제 농장 데이터가 아니다.

    python -m app.seed            # bansuk.db 초기화 후 생성
    python -m app.seed --keep     # 기존 데이터 유지 (데모 농장이 없을 때만 추가)

데모 계정
    농장주   010-0000-0000 / PIN 1234
    반석     010-1111-1111 / PIN 1234
"""
import datetime as dt
import math
import random
import sys

from .db import Base, SessionLocal, engine
from .models import DailyRecord, Farm, FarmInputConfig, Flock, FlockLocation, House, User, UserFarm
from .security import hash_pin

DEMO_FARM = "데모농장"


def _lay_rate(age_days: int) -> float:
    """대략적인 갈색 산란계 곡선 (데모용)."""
    w = age_days / 7
    if w < 18:
        return 0.0
    rise = 1 / (1 + math.exp(-1.4 * (w - 21)))
    return max(0.0, 0.95 * rise * math.exp(-0.0028 * max(0, w - 28)))


def _grade_split(age_days: int) -> dict[str, float]:
    w = age_days / 7
    big = min(1.0, max(0.0, (w - 20) / 40))
    raw = {
        "jumbo": 0.01 + 0.25 * big,
        "xl": 0.08 + 0.45 * big,
        "l": 0.55 - 0.15 * big,
        "m": 0.30 - 0.28 * big,
        "s": 0.04 - 0.035 * big,
        "double": 0.003,
        "broken": 0.004,
    }
    total = sum(raw.values())
    return {g: v / total for g, v in raw.items()}


def seed(reset: bool = True, days: int = 45) -> None:
    if reset:
        Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    db = SessionLocal()
    if db.query(Farm).filter_by(name=DEMO_FARM).first():
        print("데모 농장이 이미 있습니다.")
        return
    rnd = random.Random(42)
    today = dt.date.today()

    farm = Farm(name=DEMO_FARM, region="충북", contract_type="program")
    db.add(farm)
    db.flush()
    db.add(FarmInputConfig(farm_id=farm.id))

    # 동별 계군 일령 (오늘 기준)
    plan = [("1동", 360), ("2동", 290), ("3동", 170), ("4동", 610), ("5동", 380), ("6동", 410)]
    houses = []
    for i, (name, age) in enumerate(plan, start=1):
        h = House(farm_id=farm.id, name=name, kind="laying", sort_order=i)
        db.add(h)
        db.flush()
        placed = today - dt.timedelta(days=age - 1)
        fl = Flock(
            farm_id=farm.id,
            name=f"{placed:%y%m%d} 입추",
            placed_on=placed,
            placed_count=105000,
            breed="갈색",
            status="laying",
        )
        db.add(fl)
        db.flush()
        start = 100000 + rnd.randint(-4000, 4000)
        db.add(
            FlockLocation(
                flock_id=fl.id,
                house_id=h.id,
                from_date=placed + dt.timedelta(days=84),
                start_count=start,
            )
        )
        houses.append((h, fl, start))

    rear = House(farm_id=farm.id, name="육성사", kind="rearing", sort_order=99)
    db.add(rear)
    db.flush()
    rf = Flock(
        farm_id=farm.id,
        name="육성 계군",
        placed_on=today - dt.timedelta(days=40),
        placed_count=110000,
        breed="갈색",
        status="rearing",
    )
    db.add(rf)
    db.flush()
    db.add(FlockLocation(flock_id=rf.id, house_id=rear.id, from_date=rf.placed_on, start_count=110000))

    owner = User(name="데모 농장주", phone="01000000000", pin_hash=hash_pin("1234"), role="farm_owner")
    vet = User(name="데모 수의사", phone="01011111111", pin_hash=hash_pin("1234"), role="bansuk_vet")
    db.add_all([owner, vet])
    db.flush()
    db.add(UserFarm(user_id=owner.id, farm_id=farm.id))

    # 지난 기록 (오늘은 비워 둠 → 입력 화면 체험용)
    for h, fl, start in houses:
        count = start
        for back in range(days, 0, -1):
            day = today - dt.timedelta(days=back)
            age = (day - fl.placed_on).days + 1
            mort = max(0, int(rnd.gauss(count * 0.00012, 4)))
            count -= mort
            rate = _lay_rate(age) * (1 + rnd.gauss(0, 0.012))
            eggs = int(count * rate)
            split = _grade_split(age)
            trays = {g: round(eggs * s / 30) * 30 for g, s in split.items()}
            feed = round(count * rnd.gauss(0.118, 0.003), -1)  # kg (수당 약 118 g)
            db.add(
                DailyRecord(
                    farm_id=farm.id,
                    house_id=h.id,
                    flock_id=fl.id,
                    date=day,
                    bird_count=count,
                    mortality=mort,
                    **{f"egg_{g}": v for g, v in trays.items()},
                    feed_kg=feed,
                    water_l=round(feed * rnd.gauss(1.75, 0.05), -1),
                    temp_min=round(rnd.gauss(19, 1), 1),
                    temp_max=round(rnd.gauss(25, 1.2), 1),
                    humidity=round(rnd.gauss(60, 6)),
                    source="manual",
                )
            )
    db.commit()
    print(f"데모 데이터 생성 완료: {DEMO_FARM}, 계사 {len(houses) + 1}개, {days}일치")


if __name__ == "__main__":
    seed(reset="--keep" not in sys.argv)
