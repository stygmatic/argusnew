from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter

from app.db.connection import db
from app.db.repositories.telemetry_repo import telemetry_repo
from app.services.state_manager import state_manager

router = APIRouter(prefix="/robots", tags=["robots"])


@router.get("")
async def list_robots() -> dict[str, Any]:
    return {
        "robots": [r.to_dict() for r in state_manager.robots.values()]
    }


@router.post("")
async def register_robot(body: dict[str, Any]) -> dict[str, Any]:
    robot_id = body.get("id", "")
    if not robot_id:
        return {"error": "id is required"}
    robot = state_manager.register_robot(robot_id, body)

    # Persist to database (upsert)
    asyncio.create_task(_upsert_robot_db(robot_id, body))

    return robot.to_dict()


async def _upsert_robot_db(robot_id: str, body: dict[str, Any]) -> None:
    try:
        await db.execute(
            """
            INSERT INTO robots (id, name, robot_type)
            VALUES ($1, $2, $3)
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                updated_at = NOW()
            """,
            robot_id,
            body.get("name", robot_id),
            body.get("robot_type", "drone"),
        )
    except Exception:
        pass  # Non-critical, in-memory state is source of truth


@router.get("/{robot_id}")
async def get_robot(robot_id: str) -> dict[str, Any]:
    robot = state_manager.robots.get(robot_id)
    if robot is None:
        return {"error": "not found"}
    return robot.to_dict()


@router.get("/{robot_id}/trail")
async def get_robot_trail(robot_id: str, minutes: int = 10) -> dict[str, Any]:
    """Get recent position trail for map rendering."""
    trail = await telemetry_repo.get_trail(robot_id, minutes)
    return {"trail": trail}
