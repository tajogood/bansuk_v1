"""사양관리 엑셀 이관 테스트. 실제 농장 파일 대신 같은 구조의 가상 통합문서를 만든다."""
import datetime as dt

import openpyxl
import pytest

from app.importers.sayang import infer_flocks, parse_workbook


def _sheet(wb, title, year, month, start_age, age_fmt, rows_before=0):
    ws = wb.create_sheet(title)
    ws.cell(1, 1, f"{year}년 (   {month:02d}  월  중)  사  양  관  리  현  황")
    r = 3 + rows_before  # 해마다 행 위치가 달라지는 것을 흉내
    ws.cell(r, 1, "  구  분")
    days = 30

    def block(label, values_by_house):
        nonlocal r
        r += 1
        first = True
        for house, vals in values_by_house.items():
            if first:
                ws.cell(r, 1, label)
                first = False
            ws.cell(r, 2, house)
            for i, v in enumerate(vals):
                ws.cell(r, 3 + i, v)
            r += 1

    block("현재수수", {"  1  동": [10000 - i * 2 for i in range(days)], "2 동(대한)": [9000] * days})
    block("  폐  사", {"  1  동": [2] * days, "  2  동": [1] * days})
    block(" 산 란 율", {"  1  동": [0.9] * days})  # 계산값: 가져오지 않아야 함
    block("  특  란", {"  1  동": [3000] * days, "  2  동": [2700] * days})
    block("  대  란", {"  1  동": [6000] * days, "  2  동": [5400] * days})
    block("  사료소비", {"1동(디허스)": [1200] * days, "2 동(대한)": [1100] * days})
    ages = []
    for i in range(days):
        a = start_age + i
        if i == 0:
            ages.append(age_fmt(a))
        elif i == 9:
            ages.append(f"{a // 7}")  # 가끔 주령만 적힌 칸 (오입력)
        else:
            ages.append(a)
    block("주  령", {"  1  동": ages, "  2  동": [a + 50 if isinstance(a, int) else a for a in ages]})
    block("계사온도\n최저/최고", {"  1  동": ["20.1/25.3"] * days})
    return ws


@pytest.fixture()
def workbook(tmp_path):
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    # 2025.10: '주령-일령' 형식, 2025.11: '일령-주령' 형식 (실제 엑셀처럼 시기마다 다름)
    _sheet(wb, "25.10", 2025, 10, 300, lambda a: f"{a // 7}-{a}")
    _sheet(wb, "25.11", 2025, 11, 331, lambda a: f"{a}-{a // 7}", rows_before=5)
    _sheet(wb, "복사본", 2025, 11, 331, lambda a: f"{a}-{a // 7}")  # 같은 달 중복
    p = tmp_path / "sayang.xlsx"
    wb.save(p)
    return str(p)


def test_parse_finds_rows_by_label_not_position(workbook):
    days, rep = parse_workbook(workbook)
    assert rep.months == ["2025.10", "2025.11"]
    assert rep.duplicate_sheets == ["복사본"]
    d = next(x for x in days if x.date == dt.date(2025, 11, 1) and x.house == "1동")
    assert d.values["bird_count"] == 10000
    assert d.values["egg_xl"] == 3000 and d.values["egg_l"] == 6000
    assert d.values["feed_kg"] == 1200
    assert d.values["temp_min"] == 20.1 and d.values["temp_max"] == 25.3
    assert "lay_rate" not in d.values  # 계산값은 이관하지 않음
    assert d.feed_brand == "디허스"


def test_age_format_either_order(workbook):
    days, _ = parse_workbook(workbook)
    oct1 = next(x for x in days if x.date == dt.date(2025, 10, 1) and x.house == "1동")
    nov1 = next(x for x in days if x.date == dt.date(2025, 11, 1) and x.house == "1동")
    assert oct1.age_days == 300  # '42-300'
    assert nov1.age_days == 331  # '331-47'


def test_one_off_bad_age_does_not_split_flock(workbook):
    days, rep = parse_workbook(workbook)
    one = [f for f in rep.flocks if f["house"] == "1동"]
    assert len(one) == 1
    assert one[0]["days"] == 60  # 가상 시트는 달마다 30일씩
    # 입추일 = 2025-10-01 - (300 - 1)일 (입추일 = 1일령 기준)
    assert one[0]["placed_on"] == dt.date(2025, 10, 1) - dt.timedelta(days=299)


def test_new_flock_detected_when_age_resets():
    from app.importers.sayang import DayRow

    rows = []
    start = dt.date(2025, 1, 1)
    for i in range(40):
        rows.append(DayRow(date=start + dt.timedelta(days=i), house="1동", values={"mortality": 1}, age_days=500 + i))
    for i in range(40, 80):
        rows.append(DayRow(date=start + dt.timedelta(days=i), house="1동", values={"mortality": 1}, age_days=100 + i - 40))
    fl = infer_flocks(rows)
    assert len(fl) == 2
    assert fl[1]["first"] == start + dt.timedelta(days=40)
