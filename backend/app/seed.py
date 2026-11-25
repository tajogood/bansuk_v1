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
    _seed_cases(db, farm, owner, vet, today)
    print(f"데모 데이터 생성 완료: {DEMO_FARM}, 계군 {len(houses) + 1}개 (동마다 과거 계군 3개 포함)")




def _placeholder_jpeg(seed: int) -> bytes:
    """데모용 사진 (실제 부검 사진이 아닌 색 블록). 공개 저장소에 실제 사진을 넣지 않기 위함."""
    import io

    from PIL import Image, ImageDraw

    r = random.Random(seed)
    img = Image.new("RGB", (1200, 900), (r.randint(150, 200), r.randint(60, 90), r.randint(60, 90)))
    d = ImageDraw.Draw(img)
    for _ in range(14):
        x, y, rad = r.randint(0, 1200), r.randint(0, 900), r.randint(30, 160)
        c = (r.randint(120, 230), r.randint(40, 120), r.randint(40, 110))
        d.ellipse((x - rad, y - rad, x + rad, y + rad), fill=c)
    d.rectangle((0, 820, 1200, 900), fill=(20, 20, 20))
    d.text((24, 845), "DEMO PHOTO (not a real necropsy image)", fill=(255, 255, 255))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=85)
    return buf.getvalue()


def _seed_cases(db, farm, owner, vet, today) -> None:
    """부검 흐름의 각 단계를 보여주는 데모 건 3개."""
    from .models import CaseEvent, CasePhoto, Flock, FlockLocation, House, NecropsyCase, Notification
    from .storage import save_photo

    houses = {h.name: h for h in db.query(House).filter_by(farm_id=farm.id)}
    # 서버가 찍는 시각은 UTC로 저장한다 (부검 일정은 현장 시각)
    now_ = dt.datetime.now(dt.timezone.utc).replace(tzinfo=None, second=0, microsecond=0)

    def flock_of(h):
        loc = db.query(FlockLocation).filter(FlockLocation.house_id == h.id, FlockLocation.to_date.is_(None)).first()
        return loc.flock_id if loc else None

    def add_photos(c, stage, n, by):
        for i in range(n):
            info = save_photo(c.id, _placeholder_jpeg(c.id * 10 + i))
            db.add(CasePhoto(case_id=c.id, stage=stage, uploaded_by=by.id, **info))

    # 1) 방금 신고 (반석이 일정을 잡아야 함)
    h = houses["5동"]
    c1 = NecropsyCase(farm_id=farm.id, house_id=h.id, flock_id=flock_of(h), status="reported", awaiting="bansuk",
                      reported_by=owner.id, reported_at=now_ - dt.timedelta(hours=2), dead_count=38, onset="today",
                      symptoms=["sudden_death", "comb_color", "feed_drop"], report_note="새벽부터 여러 마리 죽어 있었습니다.",
                      proposals=[])
    db.add(c1)
    db.flush()
    db.add(CaseEvent(case_id=c1.id, author_id=owner.id, kind="reported", at=c1.reported_at,
                     data={"dead": 38, "onset": "today", "symptoms": c1.symptoms, "note": c1.report_note}))
    add_photos(c1, "report", 2, owner)
    db.add(CaseEvent(case_id=c1.id, author_id=owner.id, kind="photos", at=c1.reported_at, data={"count": 2, "stage": "report"}))
    db.add(Notification(user_id=vet.id, case_id=c1.id, kind="case_reported", created_at=c1.reported_at,
                        data={"farm": farm.name, "house": h.name, "dead": 38, "by": owner.name}))

    # 2) 일정 조정 중 (반석이 제안, 농장 답 대기)
    h = houses["2동"]
    t2 = now_ - dt.timedelta(days=1, hours=3)
    slots = [(dt.datetime.combine(today + dt.timedelta(days=1), dt.time(10, 0))).isoformat(timespec="minutes"),
             (dt.datetime.combine(today + dt.timedelta(days=1), dt.time(14, 30))).isoformat(timespec="minutes")]
    c2 = NecropsyCase(farm_id=farm.id, house_id=h.id, flock_id=flock_of(h), status="scheduling", awaiting="farm",
                      reported_by=owner.id, reported_at=t2, dead_count=12, onset="days_2_3",
                      symptoms=["respiratory", "lay_drop"], proposals=[{"at": s_, "by": "bansuk"} for s_ in slots], vet_id=vet.id)
    db.add(c2)
    db.flush()
    db.add_all([
        CaseEvent(case_id=c2.id, author_id=owner.id, kind="reported", at=t2, data={"dead": 12, "onset": "days_2_3", "symptoms": c2.symptoms}),
        CaseEvent(case_id=c2.id, author_id=vet.id, kind="proposed", at=t2 + dt.timedelta(hours=1),
                  data={"slots": slots, "message": "내일 오전이나 오후 중 편한 시간을 골라 주세요."}),
        Notification(user_id=owner.id, case_id=c2.id, kind="case_proposed", created_at=t2 + dt.timedelta(hours=1),
                     data={"farm": farm.name, "house": h.name, "dead": 12, "slots": slots, "by": vet.name}),
    ])

    # 3) 결과 공유 완료
    h = houses["4동"]
    t3 = now_ - dt.timedelta(days=9)
    sched = dt.datetime.combine(today - dt.timedelta(days=8), dt.time(10, 0))
    c3 = NecropsyCase(farm_id=farm.id, house_id=h.id, flock_id=flock_of(h), status="shared", reported_by=owner.id,
                      reported_at=t3, dead_count=21, onset="yesterday", symptoms=["lay_drop", "diarrhea"], proposals=[],
                      scheduled_at=sched, vet_id=vet.id, performed_at=sched, birds_examined=6,
                      findings=[{"organ": "liver", "lesions": ["swelling", "hemorrhage"], "note": "황색, 잘 부서짐"},
                                {"organ": "ovary", "lesions": ["congestion"], "note": None},
                                {"organ": "abdomen", "lesions": ["fat"], "note": "복강 지방 많음"}],
                      suspected=["fatty_liver"], samples=["histopath"],
                      summary="6수 부검. 간이 커지고 노랗게 변했으며 출혈이 보입니다. 복강 지방이 많습니다. 지방간 출혈 증후군으로 보입니다.",
                      advice="사료 에너지를 조금 낮추고 계사 온도가 높게 유지되지 않도록 관리해 주세요. 조직 검사 결과가 나오면 다시 알려 드리겠습니다.",
                      internal_note="노계군, 여름철 고온 영향 가능성.", shared_at=sched + dt.timedelta(hours=5))
    db.add(c3)
    db.flush()
    db.add_all([
        CaseEvent(case_id=c3.id, author_id=owner.id, kind="reported", at=t3, data={"dead": 21, "onset": "yesterday", "symptoms": c3.symptoms}),
        CaseEvent(case_id=c3.id, author_id=vet.id, kind="proposed", at=t3 + dt.timedelta(minutes=40), data={"slots": [sched.isoformat(timespec="minutes")]}),
        CaseEvent(case_id=c3.id, author_id=owner.id, kind="accepted", at=t3 + dt.timedelta(hours=2), data={"at": sched.isoformat(timespec="minutes")}),
        CaseEvent(case_id=c3.id, author_id=vet.id, kind="photos", at=sched + dt.timedelta(hours=1), data={"count": 4, "stage": "necropsy"}),
        CaseEvent(case_id=c3.id, author_id=vet.id, kind="done", at=sched + dt.timedelta(hours=2)),
        CaseEvent(case_id=c3.id, author_id=vet.id, kind="shared", at=c3.shared_at),
    ])
    add_photos(c3, "necropsy", 4, vet)
    db.commit()


if __name__ == "__main__":
    seed(reset="--keep" not in sys.argv)
