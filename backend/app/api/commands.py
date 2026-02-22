from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.db.repositories.command_repo import command_repo
from app.middleware.api_key_auth import require_api_key
from app.mqtt.client import mqtt_client
from app.services.command_service import command_service
from app.services.state_manager import state_manager
from app.ws.manager import ws_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/commands", tags=["commands"])


# ── Models for voice/external endpoints ──────────────────────────────────


class ExecuteCommandRequest(BaseModel):
    robot_id: str
    command_type: str
    parameters: dict[str, Any] = {}
    source: str = "voice"


# ── Voice / external endpoints (API-key protected) ───────────────────────


@router.post("/execute")
async def execute_command(
    body: ExecuteCommandRequest,
    _key: str = Depends(require_api_key),
) -> dict[str, Any]:
    """Execute a command on a robot. Used by Convex voice bridge."""
    robot = state_manager.robots.get(body.robot_id)
    if robot is None:
        return {"error": f"Robot {body.robot_id} not found", "status": "failed"}

    valid_commands = {
        "goto", "stop", "return_home", "patrol", "set_speed",
        "hold_position", "take_off", "land", "dive", "surface", "hold_depth",
        "set_home", "follow_waypoints", "circle_area",
    }
    if body.command_type not in valid_commands:
        return {"error": f"Invalid command type: {body.command_type}", "status": "failed"}

    # Track command source on robot
    robot.last_command_source = body.source
    robot.last_command_at = time.time()

    cmd = command_service.create_command(
        robot_id=body.robot_id,
        command_type=body.command_type,
        parameters=body.parameters,
        source=body.source,
    )
    await mqtt_client.publish(
        f"argus/{body.robot_id}/command/execute",
        {
            "command_id": cmd.id,
            "command_type": body.command_type,
            "parameters": body.parameters,
        },
    )
    command_service.update_status(cmd.id, "sent")

    await ws_manager.broadcast({
        "type": "command.status",
        "payload": cmd.to_dict(),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })

    logger.info("Voice command executed: %s -> %s (%s)", body.command_type, body.robot_id, cmd.id)
    return {"command_id": cmd.id, "status": "sent"}


@router.get("/fleet-status")
async def fleet_status(
    _key: str = Depends(require_api_key),
) -> dict[str, Any]:
    """Return summary of all robots for voice agent."""
    robots = []
    for rid, r in state_manager.robots.items():
        robots.append({
            "id": r.id,
            "name": r.name,
            "type": r.robot_type,
            "status": r.status,
            "battery": r.battery_percent,
            "position": {
                "latitude": r.latitude,
                "longitude": r.longitude,
                "altitude": r.altitude,
            },
            "autonomyTier": r.autonomy_tier,
        })
    return {"robots": robots}


# ── Existing endpoints ───────────────────────────────────────────────────


@router.get("/{robot_id}")
async def get_robot_commands(robot_id: str) -> dict[str, Any]:
    commands = command_service.get_robot_commands(robot_id)
    return {"commands": [c.to_dict() for c in commands]}


@router.get("/{robot_id}/active")
async def get_active_command(robot_id: str) -> dict[str, Any]:
    cmd = command_service.get_active_command(robot_id)
    return {"command": cmd.to_dict() if cmd else None}


@router.get("/history/{robot_id}")
async def get_command_history(robot_id: str, limit: int = 50) -> dict[str, Any]:
    """Get persisted command history from database."""
    commands = await command_repo.get_robot_commands(robot_id, limit)
    return {"commands": commands}
