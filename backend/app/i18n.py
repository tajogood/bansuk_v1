"""응답 언어 (한국어 기본, 영어 지원).

화면이 보내는 Accept-Language가 en이면, 응답을 내보내기 직전에 문자열 값을 영어로 바꾼다.
- 코드 곳곳의 한국어 문구는 그대로 두고 여기 사전에서만 번역한다 (원문이 곧 키).
- 숫자가 들어간 문구는 PATTERNS의 정규식으로 바꾼다.
- 사전에 없는 문자열(농장·계사 이름처럼 사람이 입력한 값)은 그대로 둔다.
- 발행된 보고서도 저장된 한국어 결과를 읽을 때 번역되므로 영어로 볼 수 있다.
"""
from __future__ import annotations

import contextvars
import json
import re
from typing import Any

from fastapi import Request
from fastapi.exceptions import HTTPException
from fastapi.responses import JSONResponse

_lang: contextvars.ContextVar[str] = contextvars.ContextVar("lang", default="ko")


def current_lang() -> str:
    return _lang.get()


def pick_lang(header: str | None) -> str:
    return "en" if header and header.strip().lower().startswith("en") else "ko"


EXACT: dict[str, str] = {
    # 규격
    "왕란": "Jumbo", "특란": "Extra large", "대란": "Large", "중란": "Medium", "소란": "Small",
    "쌍란": "Double yolk", "무대": "Mudae", "무중": "Mujung", "크랙": "Cracked", "파란": "Broken",
    # 역할·상태·기록
    "반석 관리자": "Bansuk admin", "수의사·연구원": "Vet / researcher", "반석 직원": "Bansuk staff", "농장": "Farm",
    "시스템": "System",
    "초기 관리자 생성": "First admin created", "계정 생성": "Account created", "계정 수정": "Account updated",
    "비밀번호 초기화": "Password reset", "첫 비밀번호 설정": "First password set", "비밀번호 변경": "Password changed",
    "잠금 해제": "Unlocked", "로그인 잠김": "Login locked", "농장 생성": "Farm created", "농장 수정": "Farm updated",
    # 비밀번호 규칙
    "영문과 숫자를 섞어 8자 이상": "at least 8 characters with letters and numbers",
    "숫자 6자리": "6 digits",
    "영문과 숫자를 섞어 8자 이상으로 정해 주세요": "Use at least 8 characters with both letters and numbers",
    "휴대폰 번호 뒷자리는 넣지 마세요": "Do not include the last digits of your phone number",
    "숫자 6자리로 정해 주세요": "Use exactly 6 digits",
    "같은 숫자 반복이나 123456 같은 연속 숫자는 쓸 수 없습니다": "Repeated digits or sequences like 123456 are not allowed",
    "휴대폰 번호의 일부는 쓸 수 없습니다": "Part of your phone number cannot be used",
    "지금 비밀번호와 다른 것으로 정해 주세요": "Choose a password different from the current one",
    # 로그인·권한
    "로그인이 필요합니다": "Please log in",
    "로그인이 만료되었습니다. 다시 로그인해 주세요": "Your session has expired. Please log in again",
    "사용할 수 없는 계정입니다": "This account is disabled",
    "새 비밀번호를 정해야 합니다": "You need to set a new password",
    "반석 관리자만 쓸 수 있습니다": "Only Bansuk admins can use this",
    "이 농장에 대한 권한이 없습니다": "You do not have access to this farm",
    "휴대폰 번호 또는 비밀번호가 맞지 않습니다": "Phone number or password is incorrect",
    "임시 비밀번호 기한이 지났습니다. 반석 관리자에게 다시 받아 주세요":
        "The temporary password has expired. Ask a Bansuk admin for a new one",
    "지금 비밀번호가 맞지 않습니다": "Current password is incorrect",
    # 관리
    "농장 계정은 농장을 하나 이상 골라야 합니다": "Select at least one farm for a farm account",
    "없는 농장이 들어 있습니다": "One of the selected farms does not exist",
    "휴대폰 번호를 확인해 주세요 (010으로 시작하는 10~11자리)": "Check the phone number (10–11 digits starting with 010)",
    "휴대폰 번호를 확인해 주세요": "Check the phone number",
    "이미 이 번호로 만든 계정이 있습니다": "An account with this phone number already exists",
    "계정이 없습니다": "Account not found",
    "관리자가 한 명은 남아 있어야 합니다": "At least one admin must remain",
    "자기 계정은 끌 수 없습니다": "You cannot disable your own account",
    "계사 이름이 겹칩니다": "House names must be unique",
    "이 농장의 계사가 아닙니다": "That house does not belong to this farm",
    "산란 규격을 확인해 주세요": "Check the egg grades",
    "같은 이름의 농장이 있습니다": "A farm with this name already exists",
    "농장이 없습니다": "Farm not found",
    # 생산·보고서·분석
    "농장을 찾을 수 없습니다": "Farm not found",
    "계사를 찾을 수 없습니다": "House not found",
    "미래 날짜는 입력할 수 없습니다": "You cannot enter a future date",
    "기간은 800일 이내로 조회해 주세요": "Choose a period of 800 days or less",
    "계군을 찾을 수 없습니다": "Flock not found",
    "정식 보고서는 반석에서 발행합니다": "Official reports are issued by Bansuk",
    "발행된 보고서를 찾을 수 없습니다": "Issued report not found",
    "분석기는 반석 계정에서 사용할 수 있습니다": "The analyzer is available to Bansuk accounts",
    "대시보드를 찾을 수 없습니다": "Dashboard not found",
    "공유 해제는 만든 사람만 할 수 있습니다": "Only the creator can stop sharing",
    "만든 사람만 지울 수 있습니다": "Only the creator can delete this",
    "지원하지 않는 지표·축·묶음입니다": "Unsupported metric, axis or grouping",
    "사료 회사·단계, 입추 계절, 부화장·품종, 점등 조건은 계군마다 다를 수 있으며 이 비교에서 보정하지 않았습니다.":
        "Feed supplier and phase, placement season, hatchery and breed, and lighting may differ between flocks and are not adjusted for in this comparison.",
    # 부검
    "부검 건을 찾을 수 없습니다": "Necropsy case not found",
    "반석 계정만 할 수 있습니다": "Only Bansuk accounts can do this",
    "날짜와 시간을 확인해 주세요": "Check the date and time",
    "지금은 일정을 바꿀 수 없는 상태입니다": "The schedule cannot be changed at this stage",
    "담당 수의사를 확인해 주세요": "Check the assigned veterinarian",
    "반석은 '일정 확정'을 쓰세요": "Bansuk staff should use “Confirm schedule”",
    "제안된 시간 중에서 골라 주세요": "Choose one of the proposed times",
    "반석은 '시간 제안'을 쓰세요": "Bansuk staff should use “Propose times”",
    "원하는 시간이나 메시지를 적어 주세요": "Enter a preferred time or a message",
    "메시지를 적어 주세요": "Enter a message",
    "부검을 마친 건은 취소할 수 없습니다": "A case cannot be cancelled after the necropsy",
    "취소된 건입니다": "This case has been cancelled",
    "결과를 먼저 저장해 주세요": "Save the results first",
    "소견 요약이나 장기별 소견을 적어 주세요": "Add a summary or findings by organ",
    "한 번에 30장까지 올릴 수 있습니다": "Up to 30 photos at a time",
    "사진을 찾을 수 없습니다": "Photo not found",
    "올린 사람만 지울 수 있습니다": "Only the uploader can delete this",
    "사진 링크가 만료되었습니다. 화면을 새로 고쳐 주세요": "The photo link has expired. Please refresh",
    "사진 한 장이 너무 큽니다 (25MB 이하)": "Photo is too large (max 25 MB)",
    "사진 파일을 읽을 수 없습니다": "Cannot read the photo file",
    # 계군 관리
    "그 기간에 이 계사에 다른 계군이 있습니다": "Another flock is in this house during that period",
    "입추일을 확인해 주세요": "Check the placement date",
    "입추일이 다음 계사 이동일보다 늦습니다": "The placement date is after the next house move",
    "종료된 계군입니다": "This flock has been closed",
    "지금 있는 계사와 같습니다": "That is the house it is already in",
    "이동일은 지금 계사에 들어간 날보다 뒤여야 합니다": "The move date must be after it entered the current house",
    "이미 종료된 계군입니다": "This flock is already closed",
    "종료일이 지금 계사에 들어간 날보다 앞섭니다": "The end date is before it entered the current house",
    "되돌릴 것이 없습니다": "Nothing to undo",
    "종료 뒤에 이 계사에 다른 계군이 들어와 되돌릴 수 없습니다": "Cannot undo: another flock entered this house after it closed",
    "이전 계사에 다른 계군이 들어와 되돌릴 수 없습니다": "Cannot undo: another flock is now in the previous house",
    "되돌릴 것이 없습니다. 입추를 취소하려면 계군을 지우세요": "Nothing to undo. Delete the flock to cancel the placement",
    "정식 발행된 보고서가 있는 계군은 지울 수 없습니다": "A flock with officially issued reports cannot be deleted",
    "입추 등록": "Flock placed", "계군 수정": "Flock edited", "계사 이동": "House move", "계군 종료": "Flock closed",
    "계군 종료 취소": "Flock reopened", "계사 이동 취소": "House move undone", "계군 삭제": "Flock deleted",
    # 분석기 카탈로그
    "생산 기록": "Production records",
    "산란율": "Lay rate", "총 산란수": "Total eggs", "수수(평균)": "Birds (average)", "폐사수": "Mortality",
    "폐사율(1만 수당 하루)": "Mortality per 10,000 birds per day", "수당 사료 섭취량": "Feed intake per bird",
    "알 1개당 사료": "Feed per egg", "수당 급수량": "Water per bird", "수사비": "Water-to-feed ratio",
    "난중": "Egg weight", "최고 온도": "Max temperature", "최저 온도": "Min temperature", "습도": "Humidity",
    "산란율 50% 이상인 날만 계산 (산란 초기·육성기 제외)":
        "Only days with lay rate of 50% or more (excludes early lay and rearing)",
    "날짜": "Date", "주(날짜)": "Week", "월": "Month", "일령": "Age (days)", "주령": "Age (weeks)",
    "계군별": "By flock", "계사별": "By house", "농장별": "By farm", "프로그램 적용 여부": "Program applied or not",
    "전체 합계": "All combined", "프로그램 적용": "Program applied", "미적용": "Not applied", "전체": "All",
    "개": " eggs", "수": " birds",
}

PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"^(.+) 비율$"), "{0} share"),
    (re.compile(r"^산란율이 ([\d.]+)%로 100%를 넘습니다\. 집란 시간이나 입력값을 확인해 주세요\.$"),
     "Lay rate is {0}%, over 100%. Check the egg collection time or the numbers entered."),
    (re.compile(r"^폐사 (\d+)수\. 평소 하루 약 (\d+)수의 (\d+)배입니다\.$"),
     "{0} birds died, about {2}× the usual {1} per day."),
    (re.compile(r"^폐사 (\d+)수\. 평소보다 많습니다\.$"), "{0} birds died, more than usual."),
    (re.compile(r"^산란율이 최근 평균\(([\d.]+)%\)보다 ([\d.]+)%p 낮습니다\.$"),
     "Lay rate is {1} points below the recent average ({0}%)."),
    (re.compile(r"^사료 섭취량이 최근 평균보다 (\d+)% 적습니다\.$"), "Feed intake is {0}% below the recent average."),
    (re.compile(r"^급수량이 최근 평균보다 (\d+)% 적습니다\.$"), "Water intake is {0}% below the recent average."),
    (re.compile(r"^비밀번호를 여러 번 틀려 잠시 잠겼습니다\. (\d+)분 뒤에 다시 해 주세요$"),
     "Locked after too many wrong passwords. Try again in {0} min"),
    (re.compile(r"^비밀번호를 (\d+)번 틀려 (\d+)분 동안 잠겼습니다$"),
     "Wrong password {0} times. Locked for {1} min"),
    (re.compile(r"^비교할 과거 계군이 (\d+)개뿐이라 순위는 참고용입니다\.$"),
     "Only {0} past flocks to compare with, so the ranking is indicative only."),
    (re.compile(r"^비교 구간 중 (\d+)%의 날에 기록이 없습니다\.$"), "{0}% of days in the comparison period have no records."),
    (re.compile(r"^산란율이 (\d+)%를 넘은 (\d+)일은 집란 시점 문제로 보고 곡선에서 뺐습니다\.$"),
     "{1} days with lay rate over {0}% were treated as egg collection timing issues and left out of the curve."),
    (re.compile(r"^(\d\d\.\d\d\.\d\d) 입추 \((.+)\)( ★)?$"), "placed {0} ({1}){2}"),
    (re.compile(r"^(.+) (\d\d\.\d\d\.\d\d) 입추 \((.+)\)( ★)?$"), "{0} placed {1} ({2}){3}"),
]


def translate(text: str) -> str:
    if text in EXACT:
        return EXACT[text]
    if not text or not any("가" <= ch <= "힣" for ch in text):
        return text
    for pat, tmpl in PATTERNS:
        m = pat.match(text)
        if m:
            parts = [translate(g) if g and pat.pattern.startswith("^(.+) 비율") else (g or "") for g in m.groups()]
            return tmpl.format(*parts)
    return text


# 사람이 직접 적은 글은 번역하지 않는다 ("확인"이라고 적은 메시지가 "OK"로 바뀌지 않게)
FREE_TEXT_KEYS = {
    "name", "text", "note", "message", "reason", "summary", "advice", "internal_note", "report_note",
    "final_diagnosis", "caption", "reviewer_note", "region", "farm", "house", "by", "author", "actor", "target",
    "suspected", "program", "breed", "hatchery", "issued_by", "owner",
}


def translate_obj(obj: Any) -> Any:
    if isinstance(obj, str):
        return translate(obj)
    if isinstance(obj, list):
        return [translate_obj(v) for v in obj]
    if isinstance(obj, dict):
        return {k: (v if k in FREE_TEXT_KEYS else translate_obj(v)) for k, v in obj.items()}
    return obj


class I18nJSONResponse(JSONResponse):
    """기본 응답 클래스. 영어 요청이면 문자열 값을 번역한다."""

    def render(self, content: Any) -> bytes:
        if current_lang() == "en":
            content = translate_obj(content)
        return json.dumps(content, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")


async def lang_middleware(request: Request, call_next):
    token = _lang.set(pick_lang(request.headers.get("accept-language")))
    try:
        return await call_next(request)
    finally:
        _lang.reset(token)


async def http_exception_handler(request: Request, exc: HTTPException):
    lang = pick_lang(request.headers.get("accept-language"))
    detail = exc.detail
    if lang == "en":  # 오류 내용은 모두 시스템 문구이므로 키와 상관없이 번역
        detail = translate(detail) if isinstance(detail, str) else (
            {k: translate(v) if isinstance(v, str) else v for k, v in detail.items()} if isinstance(detail, dict) else detail
        )
    return JSONResponse({"detail": detail}, status_code=exc.status_code, headers=getattr(exc, "headers", None))
