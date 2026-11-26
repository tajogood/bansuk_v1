"""사진 태깅에 쓰는 장기·소견 코드 (frontend/lib/cases.ts ORGANS·LESIONS와 같게 유지). 질병은 lab_catalog.DISEASE_LABELS."""

ORGANS = [
    "trachea", "lung", "air_sac", "heart", "liver", "spleen", "kidney", "ovary", "proventriculus", "gizzard",
    "intestine", "cecum", "cloaca", "abdomen", "skin_comb", "leg_joint", "brain",
    "oral", "crop", "fat", "bursa",
]
LESIONS = [
    "normal", "hemorrhage", "swelling", "atrophy", "congestion", "necrosis", "nodules", "mucus", "caseous", "fibrin",
    "discolor", "rupture", "fat", "parasite",
]
# 장기별로 학습에 쓸 만해지는 확인된 영역 수 (화면의 진행 막대 목표)
TARGET_PER_ORGAN = 150
