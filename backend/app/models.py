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
    # 이 농장 엑셀을 읽는 파서 (app/importers의 FORMATS 키). 새 농장 양식은 개발해서 등록한다.
    importer: Mapped[str | None] = mapped_column(String(40))

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
    closed_on: Mapped[dt.date | None] = mapped_column(Date)
    close_reason: Mapped[str | None] = mapped_column(String(20))  # shipped(출하) | culled(도태) | other
    close_note: Mapped[str | None] = mapped_column(String(500))
    # 적용 중인 백신프로그램 표시 이름 (분석·보고서용 캐시). 실제 적용 이력은 FlockProgram에 있고,
    # 적용·변경할 때 services.vaccines가 이 값을 함께 고친다. 비어 있으면 미적용.
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
    """계정. 휴대폰 번호는 암호화해 저장하고(phone_enc), 로그인 조회는 블라인드 인덱스(phone_idx)로 한다.
    비밀번호는 scrypt 해시만 저장한다."""

    __tablename__ = "app_user"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(50))
    phone_enc: Mapped[str] = mapped_column(String(200))
    phone_idx: Mapped[str] = mapped_column(String(64), unique=True)
    pin_hash: Mapped[str] = mapped_column(String(200))
    # admin(반석 관리자) | bansuk_vet(수의사·연구원) | bansuk_staff(반석 직원) | farm_owner(농장)
    role: Mapped[str] = mapped_column(String(20), default="farm_owner")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    # 관리자가 만든 임시 비밀번호 상태. 첫 로그인에서 새 비밀번호를 정해야 다른 화면을 쓸 수 있다.
    must_change_pin: Mapped[bool] = mapped_column(Boolean, default=True)
    temp_expires_at: Mapped[dt.datetime | None] = mapped_column(DateTime)
    failed_count: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[dt.datetime | None] = mapped_column(DateTime)
    last_login_at: Mapped[dt.datetime | None] = mapped_column(DateTime)
    pin_changed_at: Mapped[dt.datetime | None] = mapped_column(DateTime)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, server_default=func.now())

    @property
    def phone(self) -> str:
        from .crypto import decrypt

        return decrypt(self.phone_enc)

    def set_phone(self, phone: str) -> None:
        from .crypto import blind_index, encrypt
        from .security import normalize_phone

        p = normalize_phone(phone)
        self.phone_enc = encrypt(p)
        self.phone_idx = blind_index(p)


class UserFarm(Base):
    __tablename__ = "user_farm"

    user_id: Mapped[int] = mapped_column(ForeignKey("app_user.id"), primary_key=True)
    farm_id: Mapped[int] = mapped_column(ForeignKey("farm.id"), primary_key=True)


class AuthToken(Base):
    """로그인 토큰. 토큰 원문은 기기에만 있고 DB에는 SHA-256 값만 둔다."""

    __tablename__ = "auth_token"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("app_user.id"), index=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, server_default=func.now())
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime)


class AuditLog(Base):
    """계정·농장 관리 기록 (누가 언제 무엇을 바꿨는지). 비밀번호 값은 남기지 않는다."""

    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    at: Mapped[dt.datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    action: Mapped[str] = mapped_column(String(40))
    target_user_id: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    target_farm_id: Mapped[int | None] = mapped_column(ForeignKey("farm.id"))
    detail: Mapped[dict | None] = mapped_column(JSON)


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


class AnalysisDashboard(Base):
    """반석 분석기에서 만든 편집 가능한 대시보드. 위젯마다 쿼리와 차트 설정을 저장하고, 열 때 다시 계산한다."""

    __tablename__ = "analysis_dashboard"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("app_user.id"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    shared: Mapped[bool] = mapped_column(Boolean, default=False)  # 반석 팀 전체에 공유
    widgets: Mapped[list] = mapped_column(JSON, default=list)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


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


# ---------------------------------------------------------------------------
# 폐사 신고와 부검
# ---------------------------------------------------------------------------

class NecropsyCase(Base):
    """폐사 신고 한 건 = 부검 한 건. 신고 → 일정 조정 → 일정 확정 → 부검 완료 → 결과 공유.

    status:
      reported    농장이 신고함, 반석이 일정을 제안해야 함
      scheduling  일정 조정 중 (awaiting = 지금 답할 쪽: farm | bansuk)
      scheduled   일정 확정
      done        부검을 했고 결과를 쓰는 중 (농장에는 아직 안 보임)
      shared      결과를 농장에 공유함
      cancelled   취소
    """

    __tablename__ = "necropsy_case"

    id: Mapped[int] = mapped_column(primary_key=True)
    farm_id: Mapped[int] = mapped_column(ForeignKey("farm.id"), index=True)
    house_id: Mapped[int | None] = mapped_column(ForeignKey("house.id"))
    flock_id: Mapped[int | None] = mapped_column(ForeignKey("flock.id"))
    status: Mapped[str] = mapped_column(String(20), default="reported", index=True)
    awaiting: Mapped[str | None] = mapped_column(String(10))  # farm | bansuk

    # 신고 (농장)
    reported_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    reported_at: Mapped[dt.datetime] = mapped_column(DateTime, server_default=func.now())
    dead_count: Mapped[int | None] = mapped_column(Integer)
    onset: Mapped[str | None] = mapped_column(String(20))  # today | yesterday | days_2_3 | week
    symptoms: Mapped[list] = mapped_column(JSON, default=list)  # 코드 목록
    report_note: Mapped[str | None] = mapped_column(Text)

    # 일정
    proposals: Mapped[list] = mapped_column(JSON, default=list)  # [{"at": iso, "by": "bansuk"|"farm"}]
    scheduled_at: Mapped[dt.datetime | None] = mapped_column(DateTime)
    vet_id: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))

    # 부검 결과 (반석)
    performed_at: Mapped[dt.datetime | None] = mapped_column(DateTime)
    birds_examined: Mapped[int | None] = mapped_column(Integer)
    findings: Mapped[list] = mapped_column(JSON, default=list)  # [{"organ": code, "lesions": [code], "note": str}]
    suspected: Mapped[list] = mapped_column(JSON, default=list)  # 질병 코드 또는 직접 입력
    samples: Mapped[list] = mapped_column(JSON, default=list)  # 검체 코드
    summary: Mapped[str | None] = mapped_column(Text)  # 소견 요약 (농장에 보임)
    advice: Mapped[str | None] = mapped_column(Text)  # 농장 권고 사항 (농장에 보임)
    internal_note: Mapped[str | None] = mapped_column(Text)  # 반석 내부 메모 (농장에 안 보임)
    final_diagnosis: Mapped[str | None] = mapped_column(Text)  # 최종 진단 설명 (농장에 보임)
    final_diseases: Mapped[list] = mapped_column(JSON, default=list)  # 최종 진단 질병 코드 (통계·유행 질병에 씀)
    diagnosed_at: Mapped[dt.datetime | None] = mapped_column(DateTime)
    diagnosed_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    shared_at: Mapped[dt.datetime | None] = mapped_column(DateTime)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class CaseEvent(Base):
    """부검 건의 진행 기록과 메시지 (화면의 타임라인). 문구는 화면에서 kind+data로 만든다."""

    __tablename__ = "case_event"

    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("necropsy_case.id"), index=True)
    at: Mapped[dt.datetime] = mapped_column(DateTime, server_default=func.now())
    author_id: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    # reported | proposed | requested | accepted | confirmed | message | done | shared | cancelled | photos
    kind: Mapped[str] = mapped_column(String(20))
    data: Mapped[dict | None] = mapped_column(JSON)


class CasePhoto(Base):
    """부검 사진. 파일은 저장소(개발: 디스크, 운영: S3)에 두고 여기에는 위치만.

    source: case (부검 건에서 올림) | archive (지난 사진 일괄 업로드, 부검 건 없음)
    사진 태깅(반석 전용): label_status todo → done (또는 skip), 사진 단위 질병은 diseases,
    장기 영역은 PhotoRegion.
    """

    __tablename__ = "case_photo"

    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int | None] = mapped_column(ForeignKey("necropsy_case.id"), index=True)
    source: Mapped[str] = mapped_column(String(10), default="case")
    farm_id: Mapped[int | None] = mapped_column(ForeignKey("farm.id"), index=True)  # archive 사진의 농장 (선택)
    stage: Mapped[str] = mapped_column(String(10))  # report(농장 신고 때) | necropsy(부검 때) | archive
    key: Mapped[str] = mapped_column(String(200))  # 원본 저장 위치
    thumb_key: Mapped[str] = mapped_column(String(200))
    sha256: Mapped[str | None] = mapped_column(String(64), index=True)  # 같은 사진 두 번 올리기 방지
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    taken_at: Mapped[dt.datetime | None] = mapped_column(DateTime)
    caption: Mapped[str | None] = mapped_column(String(200))
    tags: Mapped[dict] = mapped_column(JSON, default=dict)
    label_status: Mapped[str] = mapped_column(String(10), default="todo", index=True)  # todo | done | skip
    diseases: Mapped[list] = mapped_column(JSON, default=list)  # 수의사가 정한 질병 코드 (없으면 [])
    normal: Mapped[bool] = mapped_column(Boolean, default=False)  # 이상 소견 없음
    label_note: Mapped[str | None] = mapped_column(String(300))
    labeled_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    labeled_at: Mapped[dt.datetime | None] = mapped_column(DateTime)
    auto_model: Mapped[str | None] = mapped_column(String(60))  # 자동 표시한 모델 버전
    auto_at: Mapped[dt.datetime | None] = mapped_column(DateTime)
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    uploaded_at: Mapped[dt.datetime] = mapped_column(DateTime, server_default=func.now())


class PhotoRegion(Base):
    """사진 속 장기 영역 하나. 좌표는 사진 크기에 대한 비율(0~1)이라 원본·축소본 어디에나 맞는다.

    source: manual (수의사가 그림) | auto (모델이 잡음)
    status: suggested (모델 제안, 확인 전) | confirmed (수의사 확인·직접 그림)
    """

    __tablename__ = "photo_region"

    id: Mapped[int] = mapped_column(primary_key=True)
    photo_id: Mapped[int] = mapped_column(ForeignKey("case_photo.id"), index=True)
    organ: Mapped[str] = mapped_column(String(30))
    lesions: Mapped[list] = mapped_column(JSON, default=list)
    points: Mapped[list] = mapped_column(JSON, default=list)  # [[x, y], …] 비율
    source: Mapped[str] = mapped_column(String(10), default="manual")
    status: Mapped[str] = mapped_column(String(10), default="confirmed")
    score: Mapped[float | None] = mapped_column(Float)
    model: Mapped[str | None] = mapped_column(String(60))
    created_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class Notification(Base):
    """앱 안 알림. 문구는 화면에서 kind+data로 만든다 (한국어·영어)."""

    __tablename__ = "notification"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("app_user.id"), index=True)
    case_id: Mapped[int | None] = mapped_column(ForeignKey("necropsy_case.id"))
    kind: Mapped[str] = mapped_column(String(30))
    dedupe_key: Mapped[str | None] = mapped_column(String(80), index=True)  # 같은 알림 두 번 안 보내기 (접종 알림 등)
    data: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
    read_at: Mapped[dt.datetime | None] = mapped_column(DateTime)


# ---------------------------------------------------------------------------
# 농장 엑셀 업로드
# ---------------------------------------------------------------------------

class ImportBatch(Base):
    """엑셀 업로드 한 번. preview(미리보기) → applied(반영) → reverted(되돌림) | discarded(취소)."""

    __tablename__ = "import_batch"

    id: Mapped[int] = mapped_column(primary_key=True)
    farm_id: Mapped[int] = mapped_column(ForeignKey("farm.id"), index=True)
    importer: Mapped[str] = mapped_column(String(40))
    filename: Mapped[str] = mapped_column(String(255))
    file_key: Mapped[str] = mapped_column(String(200))  # 원본 파일 보관 위치
    rows_key: Mapped[str | None] = mapped_column(String(200))  # 파싱한 행 (JSON) 보관 위치
    status: Mapped[str] = mapped_column(String(20), default="preview")
    overwrite_manual: Mapped[bool] = mapped_column(Boolean, default=False)
    summary: Mapped[dict] = mapped_column(JSON, default=dict)
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    uploaded_at: Mapped[dt.datetime] = mapped_column(DateTime, server_default=func.now())
    applied_at: Mapped[dt.datetime | None] = mapped_column(DateTime)
    reverted_at: Mapped[dt.datetime | None] = mapped_column(DateTime)
    reverted_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))


class ImportChange(Base):
    """반영 때 바꾼 일일 기록 하나 (되돌리기용). created면 지우고, updated면 이전 값으로 돌린다."""

    __tablename__ = "import_change"

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_id: Mapped[int] = mapped_column(ForeignKey("import_batch.id"), index=True)
    record_id: Mapped[int] = mapped_column(Integer, index=True)
    action: Mapped[str] = mapped_column(String(10))  # created | updated
    before: Mapped[dict | None] = mapped_column(JSON)


# ---------------------------------------------------------------------------
# 백신 프로그램
# ---------------------------------------------------------------------------

class Vaccine(Base):
    """백신 마스터. 혼합백신은 components에 성분(대상 질병·균주)을 여러 개 적는다."""

    __tablename__ = "vaccine"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    maker: Mapped[str | None] = mapped_column(String(100))
    kind: Mapped[str] = mapped_column(String(20), default="live")  # live | inactivated | vector | other
    route: Mapped[str] = mapped_column(String(20), default="spray")  # 기본 접종 경로
    components: Mapped[list] = mapped_column(JSON, default=list)  # [{"disease": "nd", "strain": "La Sota"}]
    note: Mapped[str | None] = mapped_column(Text)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, server_default=func.now())


class VaccineProgram(Base):
    """백신 프로그램 (버전 관리). 계군에 적용된 프로그램은 고치지 않고 새 버전으로 만든다."""

    __tablename__ = "vaccine_program"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    version: Mapped[int] = mapped_column(Integer, default=1)
    based_on_id: Mapped[int | None] = mapped_column(ForeignKey("vaccine_program.id"))
    description: Mapped[str | None] = mapped_column(Text)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, server_default=func.now())

    @property
    def label(self) -> str:
        return f"{self.name} v{self.version}"


class ProgramItem(Base):
    """프로그램의 접종 항목: 몇 일령에 어떤 백신을 어떤 경로로."""

    __tablename__ = "program_item"

    id: Mapped[int] = mapped_column(primary_key=True)
    program_id: Mapped[int] = mapped_column(ForeignKey("vaccine_program.id"), index=True)
    age_days: Mapped[int] = mapped_column(Integer)
    vaccine_id: Mapped[int] = mapped_column(ForeignKey("vaccine.id"))
    route: Mapped[str | None] = mapped_column(String(20))  # 없으면 백신 기본 경로
    note: Mapped[str | None] = mapped_column(String(300))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class FlockProgram(Base):
    """계군에 프로그램을 적용한 기간 (변경 이력). to_date가 비어 있으면 지금 적용 중."""

    __tablename__ = "flock_program"

    id: Mapped[int] = mapped_column(primary_key=True)
    flock_id: Mapped[int] = mapped_column(ForeignKey("flock.id"), index=True)
    program_id: Mapped[int | None] = mapped_column(ForeignKey("vaccine_program.id"))  # None = 프로그램 중단
    from_date: Mapped[dt.date] = mapped_column(Date)
    to_date: Mapped[dt.date | None] = mapped_column(Date)
    reason: Mapped[str | None] = mapped_column(String(500))
    set_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    set_at: Mapped[dt.datetime] = mapped_column(DateTime, server_default=func.now())


class Vaccination(Base):
    """실제 접종 기록 (반석이 직접 접종)."""

    __tablename__ = "vaccination"

    id: Mapped[int] = mapped_column(primary_key=True)
    flock_id: Mapped[int] = mapped_column(ForeignKey("flock.id"), index=True)
    house_id: Mapped[int | None] = mapped_column(ForeignKey("house.id"))
    date: Mapped[dt.date] = mapped_column(Date, index=True)
    vaccine_id: Mapped[int] = mapped_column(ForeignKey("vaccine.id"))
    route: Mapped[str | None] = mapped_column(String(20))
    birds: Mapped[int | None] = mapped_column(Integer)
    lot: Mapped[str | None] = mapped_column(String(60))
    program_item_id: Mapped[int | None] = mapped_column(ForeignKey("program_item.id"))  # 프로그램 항목에 따른 접종
    performed_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    note: Mapped[str | None] = mapped_column(String(500))
    created_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, server_default=func.now())


# ---------------------------------------------------------------------------
# 질병 검사 (반석 검사 성적서)
# ---------------------------------------------------------------------------

class LabSubmission(Base):
    """검사 의뢰 한 건 = 성적서 한 장.

    kind: pcr (PCR·RT-PCR 등 정성 검사) | serology (혈청 항체가) | culture (세균 배양) | other
    status: draft (작성 중, 농장에 안 보임) | issued (발행, 농장에 보임)
    """

    __tablename__ = "lab_submission"

    id: Mapped[int] = mapped_column(primary_key=True)
    report_no: Mapped[str | None] = mapped_column(String(40), index=True)  # 접수번호 (예: BS26-PCR-0040)
    kind: Mapped[str] = mapped_column(String(20), default="pcr")
    status: Mapped[str] = mapped_column(String(10), default="draft")
    farm_id: Mapped[int] = mapped_column(ForeignKey("farm.id"), index=True)
    house_id: Mapped[int | None] = mapped_column(ForeignKey("house.id"))
    flock_id: Mapped[int | None] = mapped_column(ForeignKey("flock.id"), index=True)
    case_id: Mapped[int | None] = mapped_column(ForeignKey("necropsy_case.id"), index=True)  # 부검 건에서 의뢰한 검사
    requester: Mapped[str | None] = mapped_column(String(60))  # 의뢰자
    requested_on: Mapped[dt.date | None] = mapped_column(Date)  # 의뢰일
    sampled_on: Mapped[dt.date | None] = mapped_column(Date, index=True)  # 시료채취일·채혈일
    issued_on: Mapped[dt.date | None] = mapped_column(Date)  # 발행일자
    age_days: Mapped[int | None] = mapped_column(Integer)  # 채취일 일령
    method: Mapped[str | None] = mapped_column(String(60))  # 검사방법 (RT-PCR, PCR, HI, ELISA, 응집 …)
    target: Mapped[str | None] = mapped_column(String(120))  # 검사질병 (예: APV (115 bp))
    disease: Mapped[str | None] = mapped_column(String(40))  # 집계용 질병 코드 (예: apv, salmonella)
    opinion: Mapped[str | None] = mapped_column(Text)  # 검사소견
    source: Mapped[str] = mapped_column(String(20), default="manual")  # manual | import
    created_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class LabSample(Base):
    """정성 검사의 시료별 결과 (성적서의 sample / 결과 표)."""

    __tablename__ = "lab_sample"

    id: Mapped[int] = mapped_column(primary_key=True)
    submission_id: Mapped[int] = mapped_column(ForeignKey("lab_submission.id"), index=True)
    sample: Mapped[str] = mapped_column(String(120))  # 예: 기관, 맹장편도 등 / 의심균주(B/C)
    result: Mapped[str] = mapped_column(String(10))  # positive | negative | suspect | na
    value: Mapped[str | None] = mapped_column(String(40))  # Ct값 등
    control: Mapped[bool] = mapped_column(Boolean, default=False)  # 양성·음성 대조
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class SeroResult(Base):
    """혈청 항체가: 항원 하나 × 구분(층·차량 등) 하나의 역가군 분포."""

    __tablename__ = "sero_result"

    id: Mapped[int] = mapped_column(primary_key=True)
    submission_id: Mapped[int] = mapped_column(ForeignKey("lab_submission.id"), index=True)
    antigen: Mapped[str] = mapped_column(String(30))  # nd_hi, lpai_hi, ib_elisa …
    group_label: Mapped[str | None] = mapped_column(String(40))  # 1층, 2층, 1호차 … (없으면 전체)
    counts: Mapped[list] = mapped_column(JSON, default=list)  # 역가군 0,1,2,… 마리 수
    n: Mapped[int] = mapped_column(Integer, default=0)
    mean: Mapped[float | None] = mapped_column(Float)  # 평균 역가군 (counts로 계산)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
