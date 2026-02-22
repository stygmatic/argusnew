from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter

from app.services.autonomy_service import autonomy_service
from app.services.state_manager import AUTONOMY_TIERS
from app.ws.manager import ws_manager

router = APIRouter(prefix="/autonomy", tags=["autonomy"])


@router.get("/tiers")
async def get_tiers() -> dict[str, Any]:
    return autonomy_service.get_tiers_summary()


@router.put("/robots/{robot_id}/tier")
async def set_robot_tier(robot_id: str, body: dict[str, Any]) -> dict[str, Any]:
    tier = body.get("tier", "")
    if tier not in AUTONOMY_TIERS:
        return {"error": f"Invalid tier. Must be one of: {', '.join(AUTONOMY_TIERS)}"}

    entry = autonomy_service.set_robot_tier(robot_id, tier)
    if entry is None:
        return {"error": "Robot not found or tier unchanged"}

    await ws_manager.broadcast({
        "type": "autonomy.changed",
        "payload": entry.to_dict(),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    return entry.to_dict()


@router.put("/fleet/default-tier")
async def set_fleet_default_tier(body: dict[str, Any]) -> dict[str, Any]:
    tier = body.get("tier", "")
    if tier not in AUTONOMY_TIERS:
        return {"error": f"Invalid tier. Must be one of: {', '.join(AUTONOMY_TIERS)}"}

    entry = autonomy_service.set_fleet_default(tier)
    if entry is None:
        return {"error": "Tier unchanged"}

    await ws_manager.broadcast({
        "type": "autonomy.changed",
        "payload": entry.to_dict(),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    return entry.to_dict()


@router.get("/log")
async def get_autonomy_log(robot_id: str | None = None, limit: int = 50) -> dict[str, Any]:
    entries = autonomy_service.get_change_log(robot_id, limit)
    return {"entries": [e.to_dict() for e in entries]}
