from __future__ import annotations

import json
import logging
from typing import Any

from app.db.connection import db

logger = logging.getLogger(__name__)


class MissionRepository:
    async def insert(
        self,
        mission_id: str,
        name: str,
        assigned_robots: list[str],
        status: str = "draft",
    ) -> None:
        try:
            await db.execute(
                """INSERT INTO missions (id, name, status, assigned_robots)
                   VALUES ($1, $2, $3, $4)""",
                mission_id,
                name,
                status,
                assigned_robots,
            )
        except Exception:
            logger.exception("Failed to insert mission %s", mission_id)

    async def update_status(self, mission_id: str, status: str) -> None:
        try:
            await db.execute(
                "UPDATE missions SET status = $2, updated_at = NOW() WHERE id = $1",
                mission_id,
                status,
            )
        except Exception:
            logger.exception("Failed to update mission status %s", mission_id)

    async def insert_waypoints(
        self,
        mission_id: str,
        robot_id: str,
        waypoints: list[dict[str, Any]],
    ) -> None:
        try:
            async with db.pool.acquire() as conn:
                await conn.executemany(
                    """INSERT INTO waypoints
                       (id, mission_id, robot_id, sequence, latitude, longitude,
                        altitude, action, parameters)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)""",
                    [
                        (
                            wp["id"],
                            mission_id,
                            robot_id,
                            wp["sequence"],
                            wp["latitude"],
                            wp["longitude"],
                            wp.get("altitude", 0.0),
                            wp.get("action", "navigate"),
                            json.dumps(wp.get("parameters", {})),
                        )
                        for wp in waypoints
                    ],
                )
        except Exception:
            logger.exception("Failed to insert waypoints for mission %s", mission_id)

    async def update_waypoint_status(
        self, waypoint_id: str, status: str
    ) -> None:
        try:
            await db.execute(
                "UPDATE waypoints SET status = $2 WHERE id = $1",
                waypoint_id,
                status,
            )
        except Exception:
            logger.exception("Failed to update waypoint status %s", waypoint_id)

    async def get_mission(self, mission_id: str) -> dict[str, Any] | None:
        row = await db.fetchrow(
            "SELECT * FROM missions WHERE id = $1", mission_id
        )
        if not row:
            return None
        return {
            "id": row["id"],
            "name": row["name"],
            "status": row["status"],
            "assignedRobots": list(row["assigned_robots"]),
            "createdAt": row["created_at"].timestamp(),
            "updatedAt": row["updated_at"].timestamp(),
        }

    async def list_missions(self, limit: int = 50) -> list[dict[str, Any]]:
        rows = await db.fetch(
            "SELECT * FROM missions ORDER BY created_at DESC LIMIT $1", limit
        )
        return [
            {
                "id": r["id"],
                "name": r["name"],
                "status": r["status"],
                "assignedRobots": list(r["assigned_robots"]),
                "createdAt": r["created_at"].timestamp(),
                "updatedAt": r["updated_at"].timestamp(),
            }
            for r in rows
        ]


mission_repo = MissionRepository()
