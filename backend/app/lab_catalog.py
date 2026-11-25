"""혈청 항원 목록 (코드 → 표시 이름, 집계용 질병 코드). 화면 이름은 frontend/lib/lab.ts에도 있다."""

ANTIGENS: dict[str, tuple[str, str]] = {
    "nd_hi": ("ND (HI)", "nd"),
    "lpai_hi": ("LPAI H9 (HI)", "lpai"),
    "eds_hi": ("EDS (HI)", "eds"),
    "sg_agg": ("SG 가금티푸스 (응집)", "fowl_typhoid"),
    "ib_elisa": ("IB (ELISA)", "ib"),
    "mg_elisa": ("MG (ELISA)", "mg_ms"),
    "ms_elisa": ("MS (ELISA)", "mg_ms"),
    "apv_elisa": ("APV (ELISA)", "apv"),
    "ciav_elisa": ("CIAV (ELISA)", "ciav"),
    "ibd_elisa": ("IBD (ELISA)", "ibd"),
    "ae_elisa": ("AE (ELISA)", "ae"),
    "reo_elisa": ("Reo (ELISA)", "reo"),
}

# 표준 양식에서 사람이 적는 이름 → 코드
ANTIGEN_ALIASES = {
    **{code: code for code in ANTIGENS},
    **{label.split(" (")[0].lower(): code for code, (label, _) in ANTIGENS.items()},
    "nd": "nd_hi", "lpai": "lpai_hi", "h9": "lpai_hi", "ai": "lpai_hi", "eds": "eds_hi", "sg": "sg_agg",
    "ib": "ib_elisa", "mg": "mg_elisa", "ms": "ms_elisa", "apv": "apv_elisa", "ciav": "ciav_elisa",
    "ibd": "ibd_elisa", "ae": "ae_elisa", "reo": "reo_elisa",
}

RESULTS = {"양성": "positive", "음성": "negative", "의심": "suspect", "positive": "positive", "negative": "negative",
           "suspect": "suspect", "+": "positive", "-": "negative", "pos": "positive", "neg": "negative"}

MAX_GROUP = 18  # 역가군 0~18


def mean_of(counts: list[int]) -> float | None:
    n = sum(c or 0 for c in counts)
    if not n:
        return None
    return round(sum(i * (c or 0) for i, c in enumerate(counts)) / n, 1)

# 질병 코드 → 이름 (frontend/lib/cases.ts DISEASES와 같게 유지)
DISEASE_LABELS = {
    "hpai": "고병원성 조류인플루엔자", "lpai": "저병원성 조류인플루엔자 (H9N2)", "nd": "뉴캐슬병",
    "ib": "전염성 기관지염", "ilt": "전염성 후두기관염", "mg_ms": "마이코플라스마 (MG·MS)", "fowl_typhoid": "가금티푸스",
    "salmonella": "살모넬라", "colibacillosis": "대장균증", "ne": "괴사성 장염", "coccidiosis": "콕시듐증",
    "marek": "마렉병", "lymphoid_leukosis": "림프성 백혈병", "fowl_pox": "계두", "eds": "산란저하증",
    "fatty_liver": "지방간 출혈 증후군", "egg_peritonitis": "난황성 복막염", "red_mite": "닭진드기",
    "heat_stress": "열 스트레스", "ibd": "전염성 F낭병 (감보로)", "ae": "조류뇌척수염", "coryza": "전염성 코라이자",
    "apv": "조류 메타뉴모바이러스 (APV)", "ciav": "닭 전염성 빈혈 (CIAV)", "reo": "레오바이러스",
}
