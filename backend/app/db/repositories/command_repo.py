from __future__ import annotations

import json
import logging
from typing import Any

from app.db.connection import db

logger = logging.getLogger(__name__)


class CommandRepository:
    async def insert(
        self,
        cmd_id: str,
        robot_id: str,
        command_type: str,
        parameters: dict[str, Any],
        source: str,
        status: str,
    ) -> None:
        try:
            await db.execute(
                """INSERT INTO commands (id, robot_id, command_type, parameters, source, status)
                   VALUES ($1, $2, $3, $4::jsonb, $5, $6)""",
                cmd_id,
                robot_id,
                command_type,
                json.dumps(parameters),
                source,
                status,
            )
        except Exception:
            logger.exception("Failed to insert command %s", cmd_id)

    async def update_status(self, cmd_id: str, status: str) -> None:
        try:
            await db.execute(
                "UPDATE commands SET status = $2, updated_at = NOW() WHERE id = $1",
                cmd_id,
                status,
            )
        except Exception:
            logger.exception("Failed to update command status %s", cmd_id)

    async def get_robot_commands(
        self, robot_id: str, limit: int = 50
    ) -> list[dict[str, Any]]:
        rows = await db.fetch(
            """SELECT id, robot_id, command_type, parameters, source, status,
                      created_at, updated_at
               FROM commands
               WHERE robot_id = $1
               ORDER BY created_at DESC
               LIMIT $2""",
            robot_id,
            limit,
        )
        return [
            {
                "id": r["id"],
                "robotId": r["robot_id"],
                "commandType": r["command_type"],
                "parameters": json.loads(r["parameters"]) if isinstance(r["parameters"], str) else r["parameters"],
                "source": r["source"],
                "status": r["status"],
                "createdAt": r["created_at"].timestamp(),
                "updatedAt": r["updated_at"].timestamp(),
            }
            for r in rows
        ]


command_repo = CommandRepository()
