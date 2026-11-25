"""반석 표준 입력 양식 (엑셀). 실제 성적서 양식 파서가 생기기 전까지 여러 건을 한 번에 넣는 용도.

시트 '혈청': 농장 | 계사 | 채혈일 | 일령 | 항원 | 구분 | 0 | 1 | … | 18   (한 줄 = 항원 × 구분)
시트 'PCR'  : 접수번호 | 농장 | 계사 | 의뢰일 | 채취일 | 일령 | 검사방법 | 검사질병 | 질병코드 | 시료 | 결과 | 값 | 대조 | 소견
             (같은 접수번호 줄은 한 성적서의 시료들)
같은 농장·계사·채혈일의 혈청 줄은 성적서 한 장으로 묶는다.
"""
from __future__ import annotations

import datetime as dt
from io import BytesIO

import openpyxl

from ..lab_catalog import ANTIGEN_ALIASES, ANTIGENS, MAX_GROUP, RESULTS

SERO_HEAD = ["농장", "계사", "채혈일", "일령", "항원", "구분"] + [str(i) for i in range(MAX_GROUP + 1)]
PCR_HEAD = ["접수번호", "농장", "계사", "의뢰일", "채취일", "일령", "검사방법", "검사질병", "질병코드", "시료", "결과", "값", "대조", "소견"]


def _date(v) -> dt.date | None:
    if v in (None, ""):
        return None
    if isinstance(v, dt.datetime):
        return v.date()
    if isinstance(v, dt.date):
        return v
    s = str(v).strip().replace(".", "-").replace("/", "-").rstrip("-")
    return dt.date.fromisoformat(s)


def _int(v) -> int | None:
    if v in (None, ""):
        return None
    return int(float(v))


def _str(v) -> str | None:
    s = str(v).strip() if v is not None else ""
    return s or None


def parse(path: str) -> list[dict]:
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    out: list[dict] = []
    if "혈청" in wb.sheetnames:
        groups: dict[tuple, dict] = {}
        for i, row in enumerate(wb["혈청"].iter_rows(min_row=2, values_only=True), start=2):
            if not row or not any(c not in (None, "") for c in row):
                continue
            row = list(row) + [None] * (len(SERO_HEAD) - len(row))
            farm, house, day, age, antigen, label = row[:6]
            code = ANTIGEN_ALIASES.get(str(antigen or "").strip().lower())
            if not code:
                raise ValueError(f"혈청 {i}행: 모르는 항원 '{antigen}'")
            key = (_str(farm), _str(house), _date(day))
            if not key[0] or not key[2]:
                raise ValueError(f"혈청 {i}행: 농장과 채혈일은 꼭 적어 주세요")
            sub = groups.setdefault(key, {"kind": "serology", "farm": key[0], "house": key[1], "sampled_on": key[2],
                                          "age_days": _int(age), "method": "HI/ELISA", "samples": [], "sero": []})
            counts = [_int(c) or 0 for c in row[6:6 + MAX_GROUP + 1]]
            while counts and counts[-1] == 0:
                counts.pop()
            sub["sero"].append({"antigen": code, "group_label": _str(label), "counts": counts})
        out.extend(groups.values())
    if "PCR" in wb.sheetnames:
        subs: dict[str, dict] = {}
        for i, row in enumerate(wb["PCR"].iter_rows(min_row=2, values_only=True), start=2):
            if not row or not any(c not in (None, "") for c in row):
                continue
            row = list(row) + [None] * (len(PCR_HEAD) - len(row))
            no, farm, house, req, samp, age, method, target, disease, sample, result, value, control, opinion = row[:14]
            key = _str(no) or f"_row{i}"
            if not _str(farm):
                raise ValueError(f"PCR {i}행: 농장을 적어 주세요")
            sub = subs.setdefault(key, {"kind": "pcr", "report_no": _str(no), "farm": _str(farm), "house": _str(house),
                                        "requested_on": _date(req), "sampled_on": _date(samp), "age_days": _int(age),
                                        "method": _str(method), "target": _str(target), "disease": _str(disease),
                                        "opinion": _str(opinion), "samples": [], "sero": []})
            if _str(sample):
                r = RESULTS.get(str(result or "").strip().lower(), RESULTS.get(str(result or "").strip(), "na"))
                sub["samples"].append({"sample": _str(sample), "result": r, "value": _str(value),
                                       "control": str(control or "").strip() in ("Y", "y", "O", "o", "1", "대조", "TRUE", "True")})
        out.extend(subs.values())
    if not out:
        raise ValueError("'혈청' 또는 'PCR' 시트에서 읽을 줄이 없습니다")
    return out


def template_bytes() -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "혈청"
    ws.append(SERO_HEAD)
    ws.append(["예시농장", "1동", "2026-10-02", 158, "IB", "", 2, 1, 7])
    ws.append(["예시농장", "1동", "2026-10-02", 158, "MG", "1층", 7, 1, 2])
    p = wb.create_sheet("PCR")
    p.append(PCR_HEAD)
    p.append(["BS26-PCR-0001", "예시농장", "4동", "2026-10-02", "2026-10-02", 163, "RT-PCR", "APV (115 bp)", "apv", "양성 대조", "양성", "", "Y", "음성으로 확인되었습니다."])
    p.append(["BS26-PCR-0001", "예시농장", "4동", "2026-10-02", "2026-10-02", 163, "RT-PCR", "APV (115 bp)", "apv", "기관, 맹장편도", "음성", "", "", ""])
    h = wb.create_sheet("항원 코드")
    h.append(["적을 이름", "항원"])
    for code, (label, _) in ANTIGENS.items():
        h.append([code.split("_")[0].upper(), label])
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()
