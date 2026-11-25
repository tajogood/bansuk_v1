from .models import DailyRecord, Farm, FarmInputConfig
from .services.daily import EDITABLE_FIELDS
from .services.metrics import compute
from .settings import DEFAULT_EGGS_PER_TRAY, DEFAULT_GRADES, EGG_GRADES


def record_dict(r: DailyRecord | None) -> dict | None:
    if r is None:
        return None
    d = {f: getattr(r, f) for f in EDITABLE_FIELDS}
    d.update(
        {
            "id": r.id,
            "date": r.date.isoformat(),
            "house_id": r.house_id,
            "flock_id": r.flock_id,
            "bird_count": r.bird_count,
            "bird_count_manual": r.bird_count_manual,
            "source": r.source,
            "metrics": compute(r),
        }
    )
    return d


def config_dict(farm: Farm) -> dict:
    c: FarmInputConfig | None = farm.config
    grades = (c.grades if c else None) or DEFAULT_GRADES
    return {
        "egg_unit": c.egg_unit if c else "tray",
        "eggs_per_tray": c.eggs_per_tray if c else DEFAULT_EGGS_PER_TRAY,
        "grades": [{"code": g, "label": EGG_GRADES[g]} for g in grades if g in EGG_GRADES],
        "show_feed": c.show_feed if c else True,
        "show_water": c.show_water if c else True,
        "show_temp": c.show_temp if c else True,
        "show_humidity": c.show_humidity if c else True,
        "show_egg_weight": c.show_egg_weight if c else False,
        "show_cull": c.show_cull if c else False,
    }
