import os

# 테스트 중에는 접종 알림 주기 작업을 끈다 (테스트에서 직접 부른다)
os.environ.setdefault("BANSUK_REMINDERS", "0")
