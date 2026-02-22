from fastapi import APIRouter

from app.db.connection import db
from app.mqtt.client import mqtt_client
from app.services.state_manager import state_manager
from app.ws.manager import ws_manager

router = APIRouter(tags=["health"])


@router.get("/health")
async def health_check() -> dict:
    """Liveness probe — always returns 200 if the process is running."""
    return {"status": "ok"}


@router.get("/health/ready")
async def readiness_check() -> dict:
    """Readiness probe — checks MQTT and database connectivity."""
    checks: dict[str, str] = {}

    # Database
    try:
        if db.pool is not None:
            async with db.pool.acquire() as conn:
                await conn.fetchval("SELECT 1")
            checks["database"] = "ok"
        else:
            checks["database"] = "not_connected"
    except Exception:
        checks["database"] = "error"

    # MQTT
    checks["mqtt"] = "ok" if mqtt_client._client is not None else "not_connected"

    # Summary
    all_ok = all(v == "ok" for v in checks.values())

    return {
        "status": "ok" if all_ok else "degraded",
        "checks": checks,
        "robots_count": len(state_manager.robots),
        "ws_clients": len(ws_manager.active_connections),
    }
