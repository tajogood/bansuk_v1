"""시스템 전역 설정."""
import os

# 일령 기준: 입추일을 몇 일령으로 볼지 (0 또는 1).
# 반석 자료마다 달라서(농장·연도별로 0일령/1일령 혼용) 확정 전까지 설정값으로 둔다.
AGE_DAY_BASE = int(os.environ.get("AGE_DAY_BASE", "1"))

# 기본 1판 = 30개 (사양관리 엑셀의 규격별 산란수가 모두 30의 배수)
DEFAULT_EGGS_PER_TRAY = 30

# 산란 규격 코드 → 표시 이름. 순서가 기본 입력 순서다.
EGG_GRADES: dict[str, str] = {
    "jumbo": "왕란",
    "xl": "특란",
    "l": "대란",
    "m": "중란",
    "s": "소란",
    "double": "쌍란",
    "mudae": "무대",
    "muzung": "무중",
    "crack": "크랙",
    "broken": "파란",
}

# 새 농장의 기본 입력 규격 (농장마다 바꿀 수 있음)
DEFAULT_GRADES = ["jumbo", "xl", "l", "m", "s", "double", "broken"]

# 현장 시간대. 부검 일정처럼 사람이 고른 시각은 이 시간대의 벽시계 시각 그대로 저장하고,
# 서버가 찍는 시각(신고·기록·알림)은 UTC로 저장해 화면에서 그 기기 시간으로 바꿔 보여준다.
LOCAL_TZ = os.environ.get("LOCAL_TZ", "Asia/Seoul")
