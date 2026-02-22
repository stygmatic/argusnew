from __future__ import annotations

import asyncio
import logging
from collections import deque
from datetime import datetime, timezone
from typing import Any

from app.db.connection import db

logger = logging.getLogger(__name__)


class TelemetryRepository:
    """Async batch-flush telemetry writer. Accumulates rows in memory
    and flushes to TimescaleDB at configurable intervals."""

    def __init__(self, flush_interval: float = 2.0, batch_size: int = 200) -> None:
        self._buffer: deque[tuple] = deque()
        self._flush_interval = flush_interval
        self._batch_size = batch_size
        self._task: asyncio.Task | None = None

    def enqueue(
        self,
        robot_id: str,
        position: dict[str, Any] | None = None,
        health: dict[str, Any] | None = None,
    ) -> None:
        """Add a telemetry row to the write buffer (non-blocking)."""
        pos = position or {}
        hlth = health or {}
        self._buffer.append((
            datetime.now(timezone.utc),
            robot_id,
            pos.get("latitude", 0.0),
            pos.get("longitude", 0.0),
            pos.get("altitude", 0.0),
            pos.get("heading", 0.0),
            pos.get("speed", 0.0),
            hlth.get("battery_percent"),
            hlth.get("signal_strength"),
        ))

    async def start(self) -> None:
        self._task = asyncio.create_task(self._flush_loop())
        logger.info("Telemetry repository started (flush every %.1fs)", self._flush_interval)

    async def _flush_loop(self) -> None:
        while True:
            await asyncio.sleep(self._flush_interval)
            await self._flush()

    async def _flush(self) -> None:
        if not self._buffer or not db.pool:
            return
        batch: list[tuple] = []
        while self._buffer and len(batch) < self._batch_size:
            batch.append(self._buffer.popleft())
        if not batch:
            return
        try:
            async with db.pool.acquire() as conn:
                await conn.executemany(
                    """INSERT INTO telemetry
                       (time, robot_id, latitude, longitude, altitude,
                        heading, speed, battery_percent, signal_strength)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)""",
                    batch,
                )
            logger.debug("Flushed %d telemetry rows", len(batch))
        except Exception:
            # Re-enqueue on failure so data isn't lost
            self._buffer.extendleft(reversed(batch))
            logger.exception("Telemetry flush failed, re-enqueued %d rows", len(batch))

    async def get_trail(
        self, robot_id: str, minutes: int = 10, limit: int = 500
    ) -> list[dict[str, Any]]:
        """Get recent position trail for map rendering."""
        rows = await db.fetch(
            """SELECT time, latitude, longitude, altitude, heading, speed
               FROM telemetry
               WHERE robot_id = $1
                 AND time > NOW() - make_interval(mins => $2)
               ORDER BY time ASC
               LIMIT $3""",
            robot_id,
            minutes,
            limit,
        )
        return [
            {
                "time": r["time"].isoformat(),
                "latitude": r["latitude"],
                "longitude": r["longitude"],
                "altitude": r["altitude"],
                "heading": r["heading"],
                "speed": r["speed"],
            }
            for r in rows
        ]

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        # Final flush
        await self._flush()
        logger.info("Telemetry repository stopped")


telemetry_repo = TelemetryRepository()
