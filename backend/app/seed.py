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


def _lay_rate(age_days: int, level: float = 1.0, shift_w: float = 0.0) -> float:
    """대략적인 갈색 산란계 곡선 (데모용). level: 피크 배율, shift_w: 성성숙 시기 이동(주)."""
    w = age_days / 7
    if w < 17:
        return 0.0
    rise = 1 / (1 + math.exp(-1.4 * (w - 21 - shift_w)))
    return max(0.0, min(0.98, 0.95 * level * rise * math.exp(-0.0028 * max(0, w - 28))))


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

    # 동별 현재 계군 일령 (오늘 기준). 3동만 반석 프로그램 적용 (데모 시나리오)
    plan = [("1동", 360), ("2동", 290), ("3동", 170), ("4동", 610), ("5동", 380), ("6동", 410)]
    houses = []
    for i, (name, age) in enumerate(plan, start=1):
        h = House(farm_id=farm.id, name=name, kind="laying", sort_order=i)
        db.add(h)
        db.flush()
        placed = today - dt.timedelta(days=age - 1)
        # 과거 계군 3개: 현재 계군 전입 전까지 약 500일씩 이어서
        transfer = placed + dt.timedelta(days=84)
        end_prev = transfer - dt.timedelta(days=10)
        for k in range(3):
            p_on = end_prev - dt.timedelta(days=560)
            pf = Flock(farm_id=farm.id, name=f"{p_on:%y%m%d} 입추", placed_on=p_on, placed_count=105000,
                       breed="갈색", status="closed")
            db.add(pf)
            db.flush()
            st = 100000 + rnd.randint(-4000, 4000)
            db.add(FlockLocation(flock_id=pf.id, house_id=h.id, from_date=p_on + dt.timedelta(days=84),
                                 to_date=end_prev, start_count=st))
            houses.append((h, pf, st, p_on + dt.timedelta(days=84), end_prev,
                           rnd.uniform(0.94, 0.99), rnd.uniform(0, 0.8), 0.00013))
            end_prev = p_on + dt.timedelta(days=74)
        fl = Flock(
            farm_id=farm.id,
            name=f"{placed:%y%m%d} 입추",
            placed_on=placed,
            placed_count=105000,
            breed="갈색",
            status="laying",
            program_name="반석 산란계 프로그램" if name == "3동" else None,
        )
        db.add(fl)
        db.flush()
        start = 100000 + rnd.randint(-4000, 4000)
        db.add(FlockLocation(flock_id=fl.id, house_id=h.id, from_date=transfer, start_count=start))
        lvl, sh, mr = (1.0, -0.3, 0.0001) if name == "3동" else (rnd.uniform(0.94, 0.99), rnd.uniform(0, 0.8), 0.00012)
        # 현재 계군은 전입부터 어제까지 (오늘은 비워 둠 → 입력 화면 체험용)
        houses.append((h, fl, start, transfer, today - dt.timedelta(days=1), lvl, sh, mr))

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

    # 데모 계정: 이미 첫 비밀번호를 정한 상태로 만든다 (관리자는 임시 비밀번호 흐름을 보여주려고 그대로 둠)
    demo = []
    for name, phone, role, pin in (
        ("데모 관리자", "01022222222", "admin", "bansuk2026"),
        ("데모 수의사", "01011111111", "bansuk_vet", "bansuk2026"),
        ("데모 농장주", "01000000000", "farm_owner", "246810"),
    ):
        u = User(name=name, role=role, pin_hash=hash_pin(pin), must_change_pin=False)
        u.set_phone(phone)
        demo.append(u)
    owner, vet = demo[2], demo[1]
    db.add_all(demo)
    db.flush()
    db.add(UserFarm(user_id=owner.id, farm_id=farm.id))

    for h, fl, start, d0, d1, lvl, sh, mr in houses:
        count = start
        day = d0
        while day <= d1:
            age = (day - fl.placed_on).days + 1
            mort = max(0, int(rnd.gauss(count * mr, 4)))
            count -= mort
            rate = _lay_rate(age, lvl, sh) * (1 + rnd.gauss(0, 0.012))
            eggs = int(count * rate)
            split = _grade_split(age)
            trays = {g: round(eggs * s / 30) * 30 for g, s in split.items()}
            feed = round(count * rnd.gauss(0.118 if fl.program_name is None else 0.121, 0.003), -1)
            db.add(
                DailyRecord(
                    farm_id=farm.id,
                    house_id=h.id,
                    flock_id=fl.id,
                    date=day,
                    bird_count=count,
                    mortality=mort,
                    **{f"egg_{g}": v for g, v in trays.items()},
                    egg_weight=round(52 + 13 * min(1, max(0, (age / 7 - 20) / 40)) + rnd.gauss(0, 0.3), 2),
                    feed_kg=feed,
                    water_l=round(feed * rnd.gauss(1.75, 0.05), -1),
                    temp_min=round(rnd.gauss(19, 1), 1),
                    temp_max=round(rnd.gauss(25, 1.2), 1),
                    humidity=round(rnd.gauss(60, 6)),
                    source="manual",
                )
            )
            day += dt.timedelta(days=1)
    db.commit()
    print(f"데모 데이터 생성 완료: {DEMO_FARM}, 계군 {len(houses) + 1}개 (동마다 과거 계군 3개 포함)")


if __name__ == "__main__":
    seed(reset="--keep" not in sys.argv)
