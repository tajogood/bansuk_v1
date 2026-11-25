"""농장 엑셀 이관 어댑터.

농장마다 사양관리 엑셀 양식이 달라서, 양식별로 어댑터를 하나씩 둔다.
모든 어댑터는 같은 결과(공통 일일 기록 DayRow 목록 + 검증 리포트)를 내고,
대시보드·보고서는 공통 기록만 읽으므로 양식이 늘어도 화면은 바뀌지 않는다.

새 양식 추가 방법
1. app/importers/<양식이름>.py 에 parse_workbook(path) -> (list[DayRow], Report) 구현
   (sayang.py의 DayRow·Report를 그대로 쓴다)
2. 아래 FORMATS에 등록
3. tests/에 가상 통합문서로 테스트 추가 (실제 농장 파일은 커밋하지 않음)
4. 농장 설정에 어떤 양식을 쓰는지 기록 (예: 파일 업로드 화면에서 선택)
"""
from . import sayang

FORMATS = {
    # 월별 시트, 행 = 항목 × 동, 열 = 1~31일 (사양관리현황)
    "sayang_monthly": sayang,
}


def get_adapter(name: str):
    try:
        return FORMATS[name]
    except KeyError as e:
        raise ValueError(f"등록되지 않은 엑셀 양식입니다: {name} (가능: {', '.join(FORMATS)})") from e
