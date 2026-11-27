"""지도용 위치 도우미. 농장 위치가 없으면 도(광역) 중심 근처에 대략 둔다."""
from __future__ import annotations

# 시·도 대략 중심 (위도, 경도)
REGION_CENTER: dict[str, tuple[float, float]] = {
    "서울": (37.566, 126.978), "인천": (37.456, 126.705), "경기": (37.41, 127.52), "강원": (37.82, 128.16),
    "충북": (36.80, 127.70), "충남": (36.52, 126.80), "대전": (36.35, 127.385), "세종": (36.48, 127.289),
    "전북": (35.72, 127.15), "전남": (34.87, 126.99), "광주": (35.16, 126.85), "경북": (36.49, 128.89),
    "경남": (35.46, 128.21), "대구": (35.87, 128.60), "울산": (35.54, 129.31), "부산": (35.18, 129.075),
    "제주": (33.49, 126.50),
}


def region_key(region: str | None) -> str:
    return (region or "").split()[0] if region else ""


def farm_point(farm) -> tuple[float, float, bool] | None:
    """(위도, 경도, 대략 위치 여부). 위치도 지역도 모르면 None."""
    if farm.lat is not None and farm.lng is not None:
        return farm.lat, farm.lng, False
    c = REGION_CENTER.get(region_key(farm.region))
    if not c:
        return None
    # 같은 도 농장이 한 점에 겹치지 않게 id로 정해지는 작은 간격 (약 5~15km)
    k = (farm.id * 2654435761) % 1000 / 1000
    j = (farm.id * 40503) % 1000 / 1000
    return c[0] + (k - 0.5) * 0.25, c[1] + (j - 0.5) * 0.3, True
