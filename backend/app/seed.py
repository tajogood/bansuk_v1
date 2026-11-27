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

    farm = Farm(name=DEMO_FARM, region="충북", contract_type="program", importer="sayang_monthly")
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
            feed = round(count * rnd.gauss(0.121 if (h.name == "3동" and fl.status != "closed") else 0.118, 0.003), -1)
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
    _seed_vaccines(db, farm, vet, today)
    _seed_lab(db, farm, vet, today)
    _seed_region_cases(db, vet, today)
    _seed_virtual_production(db, today)
    _seed_virtual_programs(db, today)
    _seed_coords(db)
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


def _seed_vaccines(db, farm, vet, today) -> None:
    """데모 백신·프로그램 (제품명은 예시). 3동 프로그램 계군에 적용하고 지난 접종을 기록한다."""
    from .models import Flock, FlockLocation, House, ProgramItem, Vaccination, Vaccine, VaccineProgram
    from .services.vaccines import assign, planned_date

    def vac(name, kind, route, comps):
        v = Vaccine(name=name, maker="예시제약", kind=kind, route=route, components=[{"disease": d, "strain": s_} for d, s_ in comps])
        db.add(v)
        db.flush()
        return v

    ndib = vac("ND+IB 생독", "live", "spray", [("nd", "La Sota"), ("ib", "H120")])
    ibd = vac("IBD 생독 (중간형)", "live", "drinking", [("ibd", None)])
    pox = vac("계두 생독", "live", "wing_web", [("fowl_pox", None)])
    ilt = vac("ILT 생독", "live", "eye_drop", [("ilt", None)])
    mg = vac("MG 생독", "live", "eye_drop", [("mg_ms", "ts-11")])
    kill4 = vac("ND+IB+EDS+AI 사독", "inactivated", "injection_im", [("nd", None), ("ib", None), ("eds", None), ("lpai", "H9N2")])
    coryza = vac("코라이자 사독", "inactivated", "injection_im", [("coryza", None)])
    nd = vac("ND 생독 (부스터)", "live", "spray", [("nd", "Clone 30")])

    prog = VaccineProgram(name="반석 산란계 프로그램", version=1, created_by=vet.id,
                          description="산란계 기본 프로그램 (데모). 산란기에는 6주마다 ND 부스터.")
    db.add(prog)
    db.flush()
    plan = [(7, ndib), (14, ibd), (21, ndib), (28, ibd), (42, ndib), (56, pox), (63, ilt), (70, ndib), (84, mg),
            (98, ndib), (112, kill4), (119, coryza), (126, ndib), (161, nd), (203, nd), (245, nd), (287, nd)]
    items = []
    for i, (age, v) in enumerate(plan):
        it = ProgramItem(program_id=prog.id, age_days=age, vaccine_id=v.id, sort_order=i)
        db.add(it)
        items.append(it)
    db.flush()

    house3 = db.query(House).filter_by(farm_id=farm.id, name="3동").one()
    loc = db.query(FlockLocation).filter(FlockLocation.house_id == house3.id, FlockLocation.to_date.is_(None)).first()
    flock = db.get(Flock, loc.flock_id)
    assign(db, flock, prog, flock.placed_on, "데모 기본 적용", vet.id)
    for it in items:
        day = planned_date(flock, it.age_days)
        if day >= today - dt.timedelta(days=12):
            continue  # 최근 항목 하나는 밀린 것으로 남겨 둔다
        db.add(Vaccination(flock_id=flock.id, house_id=house3.id, date=day, vaccine_id=it.vaccine_id, program_item_id=it.id,
                           birds=flock.placed_count, lot=f"L{day:%y%m}{it.age_days:03d}", performed_by=vet.id, created_by=vet.id))
    db.commit()


def _seed_lab(db, farm, vet, today) -> None:
    """데모 검사 결과: 2동 혈청 항체가 3회 (층별), 4동 부검 건에서 의뢰한 PCR, 작성 중인 PCR 하나."""
    from .lab_catalog import mean_of
    from .models import FlockLocation, House, LabSample, LabSubmission, NecropsyCase, SeroResult
    from .services.flocks import age_days as _age

    houses = {h.name: h for h in db.query(House).filter_by(farm_id=farm.id)}
    rnd = random.Random(7)

    def flock_at(h, day):
        loc = (db.query(FlockLocation).filter(FlockLocation.house_id == h.id, FlockLocation.from_date <= day)
               .filter((FlockLocation.to_date.is_(None)) | (FlockLocation.to_date >= day)).first())
        return loc.flock_id if loc else None

    def sub(h, day, **kw):
        from .models import Flock
        fid = flock_at(h, day)
        s_ = LabSubmission(farm_id=farm.id, house_id=h.id, flock_id=fid, sampled_on=day, requested_on=day,
                           age_days=_age(db.get(Flock, fid), day) if fid else None, created_by=vet.id, **kw)
        db.add(s_)
        db.flush()
        return s_

    def dist(center, n, spread=1.6):
        counts = [0] * 19
        for _ in range(n):
            counts[max(0, min(18, round(rnd.gauss(center, spread))))] += 1
        while counts and counts[-1] == 0:
            counts.pop()
        return counts

    h2 = houses["2동"]
    centers = {"lpai_hi": [5.2, 6.0, 5.6], "ib_elisa": [5.0, 6.8, 7.4], "apv_elisa": [4.4, 6.2, 7.0], "mg_elisa": [1.6, 2.4, 3.8]}
    for k, ago in enumerate([110, 70, 25]):
        day = today - dt.timedelta(days=ago)
        s_ = sub(h2, day, kind="serology", status="issued", issued_on=day + dt.timedelta(days=3), method="HI/ELISA",
                 report_no=f"DEMO-SERO-{k + 1:03d}")
        i = 0
        for antigen, cs in centers.items():
            for label in ("1층", "2층"):
                counts = dist(cs[k] + (0.3 if label == "2층" else 0), 8)
                db.add(SeroResult(submission_id=s_.id, antigen=antigen, group_label=label, counts=counts, n=sum(counts),
                                  mean=mean_of(counts), sort_order=i))
                i += 1

    c3 = db.query(NecropsyCase).filter_by(farm_id=farm.id, house_id=houses["4동"].id).first()
    day = today - dt.timedelta(days=8)
    s_ = sub(houses["4동"], day, kind="pcr", status="issued", issued_on=day + dt.timedelta(days=2), case_id=c3.id if c3 else None,
             report_no="DEMO-PCR-0001", method="RT-PCR", target="IB (RT-PCR)", disease="ib",
             opinion="의뢰하신 가검물에서 IB가 음성으로 확인되었습니다.")
    for i, (smp, res, ctl) in enumerate([("IB 양성 대조", "positive", True), ("IB 음성 대조", "negative", True),
                                          ("기관, 신장", "negative", False)]):
        db.add(LabSample(submission_id=s_.id, sample=smp, result=res, control=ctl, sort_order=i))
    if c3:
        c3.final_diagnosis = "조직 검사 확인. IB 음성."
        c3.final_diseases = ["fatty_liver"]
        c3.diagnosed_at = dt.datetime.combine(day + dt.timedelta(days=2), dt.time(5, 0))
        c3.diagnosed_by = vet.id

    day = today - dt.timedelta(days=1)
    s_ = sub(houses["2동"], day, kind="pcr", status="draft", report_no="DEMO-PCR-0002", method="RT-PCR",
             target="APV (115 bp)", disease="apv")
    for i, (smp, res, ctl) in enumerate([("APV 양성 대조", "positive", True), ("APV 음성 대조", "negative", True),
                                          ("기관, 맹장편도", "positive", False)]):
        db.add(LabSample(submission_id=s_.id, sample=smp, result=res, control=ctl, sort_order=i))
    db.commit()


def _seed_virtual_production(db, today) -> None:
    """가상농장 7곳에도 계군과 일일 기록을 넣어 전체 현황 화면이 실제처럼 보이게 한다.

    시나리오: 정상 / 최근 산란율 급락(질병 의심) / 육성 끝나고 올라가는 계군 / 노계 하락·오늘 미입력 /
    상위 성적 / 며칠째 미입력 / 소규모.
    """
    rnd = random.Random(7)
    plans = {
        # 농장: (오늘 입력 여부, 마지막 입력 며칠 전, [(동 이름, 일령, 수준, 급락 시작 며칠 전 or None)])
        "가상농장 가": (True, 0, [("1동", 300, 0.97, None), ("2동", 420, 0.96, None), ("3동", 210, 0.98, None)]),
        "가상농장 나": (True, 0, [("1동", 330, 0.96, None), ("2동", 260, 0.97, 9), ("3동", 480, 0.95, None)]),
        "가상농장 다": (False, 1, [("1동", 150, 1.0, None), ("2동", 175, 0.99, None)]),
        "가상농장 라": (False, 1, [("1동", 640, 0.93, None), ("2동", 590, 0.94, None), ("3동", 700, 0.92, None)]),
        "가상농장 마": (True, 0, [("1동", 280, 1.02, None), ("2동", 350, 1.01, None)]),
        "가상농장 바": (False, 4, [("1동", 390, 0.95, None), ("2동", 455, 0.95, None)]),
        "가상농장 사": (True, 0, [("1동", 250, 0.97, None)]),
    }
    for farm in db.query(Farm).filter(Farm.name.in_(list(plans))):
        if db.query(Flock).filter_by(farm_id=farm.id).first():
            continue  # 이미 넣은 농장은 건너뜀 (여러 번 실행해도 안전)
        entered_today, lag, houses = plans[farm.name]
        if not db.query(FarmInputConfig).filter_by(farm_id=farm.id).first():
            db.add(FarmInputConfig(farm_id=farm.id))
        existing = {h.name: h for h in db.query(House).filter_by(farm_id=farm.id)}
        for i, (hname, age, lvl, drop) in enumerate(houses):
            h = existing.get(hname)
            if not h:
                h = House(farm_id=farm.id, name=hname, kind="laying", sort_order=i)
                db.add(h)
                db.flush()
            placed = today - dt.timedelta(days=age - 1)
            transfer = placed + dt.timedelta(days=84)
            fl = Flock(farm_id=farm.id, name=f"{placed:%y%m%d} 입추", placed_on=placed, placed_count=52000,
                       breed=rnd.choice(["갈색", "Hy-Line Brown", "로만 브라운"]), status="laying")
            db.add(fl)
            db.flush()
            count = 50000 + rnd.randint(-3000, 3000)
            db.add(FlockLocation(flock_id=fl.id, house_id=h.id, from_date=transfer, start_count=count))
            d = max(transfer, today - dt.timedelta(days=180))
            end = today if entered_today else today - dt.timedelta(days=lag)
            sh = rnd.uniform(-0.3, 0.6)
            while d <= end:
                a = (d - placed).days + 1
                back = (today - d).days
                factor = 1.0
                if drop is not None and back <= drop:
                    factor = 1 - 0.018 * (drop - back + 1)  # 하루 1.8%p씩 떨어짐
                mort = max(0, int(rnd.gauss(count * (0.00045 if factor < 1 else 0.00012), 2)))
                count -= mort
                rate = _lay_rate(a, lvl, sh) * factor * (1 + rnd.gauss(0, 0.01))
                eggs = int(count * rate)
                split = _grade_split(a)
                feed = round(count * rnd.gauss(0.118, 0.003), -1)
                db.add(DailyRecord(
                    farm_id=farm.id, house_id=h.id, flock_id=fl.id, date=d, bird_count=count, mortality=mort,
                    **{f"egg_{g}": round(eggs * v / 30) * 30 for g, v in split.items()},
                    egg_weight=round(52 + 13 * min(1, max(0, (a / 7 - 20) / 40)) + rnd.gauss(0, 0.3), 2),
                    feed_kg=feed, water_l=round(feed * rnd.gauss(1.75, 0.05), -1),
                    temp_min=round(rnd.gauss(18, 1), 1), temp_max=round(rnd.gauss(25, 1.2), 1),
                    humidity=round(rnd.gauss(60, 6)), source="manual",
                ))
                d += dt.timedelta(days=1)
    db.commit()


DEMO_COORDS = {  # 산란계 농장이 많은 지역 근처의 그럴듯한 위치 (가상)
    "데모농장": (36.94, 127.69), "가상농장 가": (37.01, 127.28), "가상농장 나": (37.89, 127.20), "가상농장 다": (36.19, 127.10),
    "가상농장 라": (36.86, 127.44), "가상농장 마": (35.80, 126.88), "가상농장 바": (36.41, 128.16), "가상농장 사": (35.54, 128.49),
}


def _seed_coords(db) -> None:
    """데모 농장 위치를 채운다 (비어 있을 때만)."""
    for f in db.query(Farm).filter(Farm.name.in_(list(DEMO_COORDS)), Farm.lat.is_(None)):
        f.lat, f.lng = DEMO_COORDS[f.name]
    db.commit()


def _seed_virtual_programs(db, today) -> None:
    """가상농장 일부 계군에 반석 프로그램을 적용하고 지난 접종을 기록한다 (접종 달력 데모).
    가상농장 나 2동은 최근 항목 하나를 비워 밀린 접종으로 남긴다. 이미 적용된 계군은 건너뛴다."""
    from .models import FlockProgram, ProgramItem, Vaccination, VaccineProgram
    from .services.vaccines import assign, planned_date

    prog = db.query(VaccineProgram).filter(VaccineProgram.name == "반석 산란계 프로그램").order_by(VaccineProgram.version.desc()).first()
    vet = db.query(User).filter(User.role == "bansuk_vet").first()
    if not prog or not vet:
        return
    items = db.query(ProgramItem).filter_by(program_id=prog.id).order_by(ProgramItem.age_days).all()
    targets = {("가상농장 가", "3동"), ("가상농장 나", "2동"), ("가상농장 다", "1동"), ("가상농장 다", "2동"),
               ("가상농장 마", "1동"), ("가상농장 사", "1동"), ("가상농장 가", "1동")}
    for farm in db.query(Farm).filter(Farm.name.like("가상농장 %")):
        for h in db.query(House).filter_by(farm_id=farm.id):
            if (farm.name, h.name) not in targets:
                continue
            loc = db.query(FlockLocation).filter(FlockLocation.house_id == h.id, FlockLocation.to_date.is_(None)).first()
            if not loc:
                continue
            fl = db.get(Flock, loc.flock_id)
            if db.query(FlockProgram).filter_by(flock_id=fl.id).first():
                continue
            assign(db, fl, prog, fl.placed_on, "데모 적용", vet.id)
            fl.program_name = prog.name
            skip_recent = farm.name == "가상농장 나"
            for it in items:
                day = planned_date(fl, it.age_days)
                if day > today - dt.timedelta(days=2):
                    continue
                if skip_recent and day >= today - dt.timedelta(days=20):
                    continue
                db.add(Vaccination(flock_id=fl.id, house_id=h.id, date=day, vaccine_id=it.vaccine_id, program_item_id=it.id,
                                   birds=fl.placed_count, lot=f"L{day:%y%m}{it.age_days:03d}", performed_by=vet.id, created_by=vet.id))
    db.commit()


def _seed_region_cases(db, vet, today) -> None:
    """최근 유행 질병 화면용: 지역별 가상 농장의 부검 건과 PCR 양성 결과 (일일 기록 없음)."""
    from .models import Farm, House, LabSample, LabSubmission, NecropsyCase

    rnd = random.Random(11)
    farms = []
    for name, region in [("가상농장 가", "경기"), ("가상농장 나", "경기"), ("가상농장 다", "충남"), ("가상농장 라", "충북"),
                         ("가상농장 마", "전북"), ("가상농장 바", "경북"), ("가상농장 사", "경남")]:
        f = Farm(name=name, region=region, contract_type="program")
        db.add(f)
        db.flush()
        h = House(farm_id=f.id, name="1동", kind="laying", sort_order=0)
        db.add(h)
        db.flush()
        farms.append((f, h))
    # (질병, 최근 몇 주 안, 건수) — 최근 APV·IB가 늘어나는 모양
    plan = [("apv", 4, 7), ("apv", 12, 2), ("ib", 6, 5), ("ib", 12, 2), ("mg_ms", 12, 4), ("colibacillosis", 12, 5),
            ("lpai", 3, 2), ("coryza", 8, 2), ("fowl_typhoid", 12, 1), ("red_mite", 10, 2)]
    lab_target = {"apv": ("RT-PCR", "APV (115 bp)"), "ib": ("RT-PCR", "IB"), "mg_ms": ("PCR", "MG"),
                  "lpai": ("RT-PCR", "AI H9"), "coryza": ("PCR", "Av. paragallinarum"), "fowl_typhoid": ("배양", "S. Gallinarum")}
    no = 100
    for disease, weeks, n in plan:
        for _ in range(n):
            f, h = rnd.choice(farms)
            day = today - dt.timedelta(days=rnd.randint(0, weeks * 7 - 1))
            at = dt.datetime.combine(day, dt.time(10, 0))
            c = NecropsyCase(farm_id=f.id, house_id=h.id, status="shared", reported_at=at - dt.timedelta(days=1),
                             dead_count=rnd.randint(8, 60), onset="yesterday", symptoms=[], proposals=[], scheduled_at=at,
                             vet_id=vet.id, performed_at=at, birds_examined=rnd.randint(3, 8), findings=[], samples=["pcr"],
                             suspected=[disease], shared_at=at + dt.timedelta(hours=4))
            if rnd.random() < 0.7:  # 대부분은 검사 뒤 최종 진단까지
                c.final_diseases, c.diagnosed_at, c.diagnosed_by = [disease], at + dt.timedelta(days=3), vet.id
            db.add(c)
            db.flush()
            if disease in lab_target and rnd.random() < 0.8:
                method, target = lab_target[disease]
                no += 1
                s_ = LabSubmission(farm_id=f.id, house_id=h.id, case_id=c.id, kind="culture" if method == "배양" else "pcr",
                                   status="issued", sampled_on=day, issued_on=day + dt.timedelta(days=2), method=method,
                                   target=target, disease=disease, report_no=f"DEMO-PCR-{no:04d}", created_by=vet.id)
                db.add(s_)
                db.flush()
                db.add(LabSample(submission_id=s_.id, sample="가검물", result="positive", sort_order=0))
    db.commit()


def keep_configured_admin() -> None:
    """설치 때 정한 관리자(BANSUK_ADMIN_PHONE)를 데모 데이터와 함께 남긴다. 이미 있으면 그대로 둔다."""
    import os

    from .security import find_user_by_phone, set_temp_pin

    phone = os.environ.get("BANSUK_ADMIN_PHONE")
    if not phone:
        return
    db = SessionLocal()
    try:
        if find_user_by_phone(db, phone):
            return
        u = User(name=os.environ.get("BANSUK_ADMIN_NAME", "반석 관리자"), role="admin")
        u.set_phone(phone)
        db.add(u)
        temp = set_temp_pin(u)
        db.commit()
        print(f"설치 때 정한 관리자 계정도 만들었습니다: {phone}, 임시 비밀번호 {temp} (첫 로그인 때 바꿔야 함)")
    finally:
        db.close()


if __name__ == "__main__":
    if "--virtual-only" in sys.argv:  # 기존 DB를 지우지 않고 가상농장 생산 기록만 추가
        _db = SessionLocal()
        _seed_virtual_production(_db, dt.date.today())
        _seed_virtual_programs(_db, dt.date.today())
        _seed_coords(_db)
        _db.close()
        print("가상농장 생산 기록을 추가했습니다.")
    else:
        seed(reset="--keep" not in sys.argv)
        keep_configured_admin()
