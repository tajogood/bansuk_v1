from __future__ import annotations

from sqlalchemy.orm import Session

from .models import AuditLog


def audit(
    db: Session,
    actor_id: int | None,
    action: str,
    *,
    target_user_id: int | None = None,
    target_farm_id: int | None = None,
    detail: dict | None = None,
) -> None:
    """관리 기록 한 줄. 커밋은 부르는 쪽에서 (같은 트랜잭션으로 남도록)."""
    db.add(
        AuditLog(
            actor_id=actor_id,
            action=action,
            target_user_id=target_user_id,
            target_farm_id=target_farm_id,
            detail=detail,
        )
    )
