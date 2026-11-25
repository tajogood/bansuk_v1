"""데이터 모델 (1단계: 생산 MVP 범위).

설계서 6절의 테이블 중 생산 입력에 필요한 것부터 구현한다.
계산값(산란율, 일령 등)은 저장하지 않고 services/metrics.py에서 매번 계산한다.
"""
from __future__ import annotations

import datetime as dt

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base
from .settings import DEFAULT_EGGS_PER_TRAY, DEFAULT_GRADES


class Farm(Base):
    __tablename__ = "farm"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    region: Mapped[str | None] = mapped_column(String(100))
    # program: 반석 백신프로그램 운영 / test_only: 검사만 의뢰
    contract_type: Mapped[str] = mapped_column(String(20), default="program")
    contract_start: Mapped[dt.date | None] = mapped_column(Date)
    contract_end: Mapped[dt.date | None] = mapped_column(Date)
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    houses: Mapped[list[House]] = relationship(back_populates="farm", order_by="House.sort_order")
    config: Mapped[FarmInputConfig | None] = relationship(back_populates="farm", uselist=False)


class FarmInputConfig(Base):
    """농장별 일일 입력 화면 설정. 농장마다 기록하는 항목이 달라서 화면을 맞춘다."""

    __tablename__ = "farm_input_config"

    farm_id: Mapped[int] = mapped_column(ForeignKey("farm.id"), primary_key=True)
    egg_unit: Mapped[str] = mapped_column(String(10), default="tray")  # tray(판) | egg(개)
    eggs_per_tray: Mapped[int] = mapped_column(Integer, default=DEFAULT_EGGS_PER_TRAY)
    grades: Mapped[list] = mapped_column(JSON, default=lambda: list(DEFAULT_GRADES))
    show_feed: Mapped[bool] = mapped_column(Boolean, default=True)
    show_water: Mapped[bool] = mapped_column(Boolean, default=True)
    show_temp: Mapped[bool] = mapped_column(Boolean, default=True)
    show_humidity: Mapped[bool] = mapped_column(Boolean, default=True)
    show_egg_weight: Mapped[bool] = mapped_column(Boolean, default=False)
    show_cull: Mapped[bool] = mapped_column(Boolean, default=False)  # 도태: 거의 안 쓰는 농장이 많음

    farm: Mapped[Farm] = relationship(back_populates="config")


class House(Base):
    __tablename__ = "house"

    id: Mapped[int] = mapped_column(primary_key=True)
    farm_id: Mapped[int] = mapped_column(ForeignKey("farm.id"), index=True)
    name: Mapped[str] = mapped_column(String(50))
    kind: Mapped[str] = mapped_column(String(20), default="laying")  # laying | rearing
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    farm: Mapped[Farm] = relationship(back_populates="houses")


class Flock(Base):
    """계군: 같은 날 입추한 닭 무리. 모든 기록의 기준 단위."""

    __tablename__ = "flock"

    id: Mapped[int] = mapped_column(primary_key=True)
    farm_id: Mapped[int] = mapped_column(ForeignKey("farm.id"), index=True)
    name: Mapped[str | None] = mapped_column(String(100))
    placed_on: Mapped[dt.date] = mapped_column(Date)
    placed_count: Mapped[int] = mapped_column(Integer)
    breed: Mapped[str | None] = mapped_column(String(50))  # 예: 갈색, 백색, Hy-Line Brown
    hatchery: Mapped[str | None] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(20), default="laying")  # rearing | laying | closed
    # 적용한 반석 백신프로그램 이름 (없으면 미적용). 2단계에서 vaccine_program 테이블로 연결한다.
    program_name: Mapped[str | None] = mapped_column(String(100))

    locations: Mapped[list[FlockLocation]] = relationship(
        back_populates="flock", order_by="FlockLocation.from_date"
    )


class FlockLocation(Base):
    """계군이 어느 계사에 언제부터 언제까지 있었는지 (육성사 → 성계사 이동 이력)."""

    __tablename__ = "flock_location"

    id: Mapped[int] = mapped_column(primary_key=True)
    flock_id: Mapped[int] = mapped_column(ForeignKey("flock.id"), index=True)
    house_id: Mapped[int] = mapped_column(ForeignKey("house.id"), index=True)
    from_date: Mapped[dt.date] = mapped_column(Date)
    to_date: Mapped[dt.date | None] = mapped_column(Date)
    start_count: Mapped[int | None] = mapped_column(Integer)  # 전입 수수

    flock: Mapped[Flock] = relationship(back_populates="locations")


class User(Base):
    __tablename__ = "app_user"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(50))
    phone: Mapped[str] = mapped_column(String(20), unique=True)
    pin_hash: Mapped[str] = mapped_column(String(200))
    # farm_owner | bansuk_vet | bansuk_staff | admin
    role: Mapped[str] = mapped_column(String(20), default="farm_owner")
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class UserFarm(Base):
    __tablename__ = "user_farm"

    user_id: Mapped[int] = mapped_column(ForeignKey("app_user.id"), primary_key=True)
    farm_id: Mapped[int] = mapped_column(ForeignKey("farm.id"), primary_key=True)


class AuthToken(Base):
    __tablename__ = "auth_token"

    token: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("app_user.id"), index=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, server_default=func.now())


class IssuedReport(Base):
    """발행한 정식 보고서. 발행 시점의 계산 결과를 그대로 고정해, 나중에 데이터가 바뀌어도
    같은 번호의 보고서는 같은 내용을 보여준다 (대외 제출용 신뢰성)."""

    __tablename__ = "issued_report"

    id: Mapped[int] = mapped_column(primary_key=True)
    report_no: Mapped[str] = mapped_column(String(40), unique=True)
    kind: Mapped[str] = mapped_column(String(30), default="flock_performance")
    farm_id: Mapped[int] = mapped_column(ForeignKey("farm.id"), index=True)
    flock_id: Mapped[int | None] = mapped_column(ForeignKey("flock.id"))
    params: Mapped[dict] = mapped_column(JSON)
    payload: Mapped[dict] = mapped_column(JSON)
    fingerprint: Mapped[str] = mapped_column(String(32))
    reviewer_note: Mapped[str | None] = mapped_column(Text)
    issued_by: Mapped[int] = mapped_column(ForeignKey("app_user.id"))
    issued_at: Mapped[dt.datetime] = mapped_column(DateTime, server_default=func.now())


class DailyRecord(Base):
    """계사별 하루 생산 기록. 원자료만 저장한다."""

    __tablename__ = "daily_record"
    __table_args__ = (UniqueConstraint("house_id", "date", name="uq_daily_house_date"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    farm_id: Mapped[int] = mapped_column(ForeignKey("farm.id"), index=True)
    house_id: Mapped[int] = mapped_column(ForeignKey("house.id"), index=True)
    flock_id: Mapped[int | None] = mapped_column(ForeignKey("flock.id"), index=True)
    date: Mapped[dt.date] = mapped_column(Date, index=True)

    # 수수: 그날 끝 기준. 보통 전일 수수 - 폐사 - 도태로 자동 계산하고,
    # 실사 등으로 직접 고친 날은 bird_count_manual=True로 표시해 자동 재계산에서 뺀다.
    bird_count: Mapped[int | None] = mapped_column(Integer)
    bird_count_manual: Mapped[bool] = mapped_column(Boolean, default=False)
    mortality: Mapped[int | None] = mapped_column(Integer)
    cull: Mapped[int | None] = mapped_column(Integer)

    # 규격별 산란수 (개 단위로 저장. 화면에서는 판 단위로 입력 가능)
    egg_jumbo: Mapped[int | None] = mapped_column(Integer)
    egg_xl: Mapped[int | None] = mapped_column(Integer)
    egg_l: Mapped[int | None] = mapped_column(Integer)
    egg_m: Mapped[int | None] = mapped_column(Integer)
    egg_s: Mapped[int | None] = mapped_column(Integer)
    egg_double: Mapped[int | None] = mapped_column(Integer)
    egg_mudae: Mapped[int | None] = mapped_column(Integer)
    egg_muzung: Mapped[int | None] = mapped_column(Integer)
    egg_crack: Mapped[int | None] = mapped_column(Integer)
    egg_broken: Mapped[int | None] = mapped_column(Integer)

    egg_weight: Mapped[float | None] = mapped_column(Float)  # g
    body_weight: Mapped[float | None] = mapped_column(Float)  # g
    feed_kg: Mapped[float | None] = mapped_column(Float)
    water_l: Mapped[float | None] = mapped_column(Float)
    temp_min: Mapped[float | None] = mapped_column(Float)
    temp_max: Mapped[float | None] = mapped_column(Float)
    humidity: Mapped[float | None] = mapped_column(Float)  # %
    memo: Mapped[str | None] = mapped_column(Text)

    source: Mapped[str] = mapped_column(String(20), default="manual")  # manual | upload | sensor
    entered_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    def egg(self, grade: str) -> int | None:
        return getattr(self, f"egg_{grade}")
