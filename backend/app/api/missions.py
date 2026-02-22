from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter

from app.services.mission_service import mission_service
from app.ws.manager import ws_manager

router = APIRouter(prefix="/missions", tags=["missions"])


@router.get("")
async def list_missions() -> dict[str, Any]:
    missions = mission_service.list_missions()
    return {"missions": [m.to_dict() for m in missions]}


@router.post("")
async def create_mission(body: dict[str, Any]) -> dict[str, Any]:
    name = body.get("name", "Unnamed Mission")
    assigned_robots = body.get("assignedRobots", [])
    waypoints = body.get("waypoints", {})
    mission = mission_service.create_mission(name, assigned_robots, waypoints)

    await ws_manager.broadcast(
        {
            "type": "mission.updated",
            "payload": mission.to_dict(),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    )
    return mission.to_dict()


@router.get("/{mission_id}")
async def get_mission(mission_id: str) -> dict[str, Any]:
    mission = mission_service.get_mission(mission_id)
    if mission is None:
        return {"error": "not found"}
    return mission.to_dict()


@router.post("/{mission_id}/activate")
async def activate_mission(mission_id: str) -> dict[str, Any]:
    mission = mission_service.update_status(mission_id, "active")
    if mission is None:
        return {"error": "not found"}

    await ws_manager.broadcast(
        {
            "type": "mission.updated",
            "payload": mission.to_dict(),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    )
    return mission.to_dict()


@router.post("/{mission_id}/abort")
async def abort_mission(mission_id: str) -> dict[str, Any]:
    mission = mission_service.update_status(mission_id, "aborted")
    if mission is None:
        return {"error": "not found"}

    await ws_manager.broadcast(
        {
            "type": "mission.updated",
            "payload": mission.to_dict(),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    )
    return mission.to_dict()
