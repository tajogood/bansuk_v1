from __future__ import annotations

from pydantic import BaseModel, Field


class LoginIn(BaseModel):
    phone: str
    pin: str = Field(min_length=1, max_length=128)


class DailyIn(BaseModel):
    """일일 입력. 산란수는 개 단위 (화면에서 판 → 개 변환 후 전송)."""

    bird_count: int | None = Field(default=None, ge=0, description="직접 고칠 때만")
    mortality: int | None = Field(default=None, ge=0)
    cull: int | None = Field(default=None, ge=0)
    egg_jumbo: int | None = Field(default=None, ge=0)
    egg_xl: int | None = Field(default=None, ge=0)
    egg_l: int | None = Field(default=None, ge=0)
    egg_m: int | None = Field(default=None, ge=0)
    egg_s: int | None = Field(default=None, ge=0)
    egg_double: int | None = Field(default=None, ge=0)
    egg_mudae: int | None = Field(default=None, ge=0)
    egg_muzung: int | None = Field(default=None, ge=0)
    egg_crack: int | None = Field(default=None, ge=0)
    egg_broken: int | None = Field(default=None, ge=0)
    egg_weight: float | None = Field(default=None, ge=0, le=120)
    body_weight: float | None = Field(default=None, ge=0)
    feed_kg: float | None = Field(default=None, ge=0)
    water_l: float | None = Field(default=None, ge=0)
    temp_min: float | None = Field(default=None, ge=-30, le=60)
    temp_max: float | None = Field(default=None, ge=-30, le=60)
    humidity: float | None = Field(default=None, ge=0, le=100)
    memo: str | None = Field(default=None, max_length=1000)
