"""검사 성적서 파서.

검사기관·양식마다 파서를 하나씩 둔다. 실제 성적서 파일 형식이 정해지면 여기에 추가한다.
모든 파서는 parse(path) -> list[dict] 를 구현하고, 각 dict는 아래 공통 형태다.

    {
      "kind": "pcr" | "serology" | "culture" | "other",
      "farm": "농장 이름", "house": "계사 이름" | None,
      "report_no": str | None, "requester": str | None,
      "requested_on": date | None, "sampled_on": date | None, "issued_on": date | None,
      "age_days": int | None, "method": str | None, "target": str | None, "disease": str | None,
      "opinion": str | None,
      "samples": [{"sample": str, "result": "positive"|"negative"|"suspect"|"na", "value": str|None, "control": bool}],
      "sero": [{"antigen": "nd_hi" …, "group_label": str|None, "counts": [int, …]}],
    }

새 양식 추가: app/lab_importers/<이름>.py 에 parse 구현 → FORMATS 등록 → tests에 가상 파일로 테스트.
지금 있는 것: standard_xlsx (반석 표준 입력 양식, /api/lab/template.xlsx 로 받음)
"""
from . import standard

FORMATS = {"standard_xlsx": standard}
LABELS = {"standard_xlsx": "반석 표준 입력 양식 (엑셀)"}


def get_parser(name: str):
    try:
        return FORMATS[name]
    except KeyError as e:
        raise ValueError("등록되지 않은 성적서 양식입니다") from e
