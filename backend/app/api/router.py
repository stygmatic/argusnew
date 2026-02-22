from fastapi import APIRouter

from app.api.ai import router as ai_router
from app.api.autonomy import router as autonomy_router
from app.api.commands import router as commands_router
from app.api.health import router as health_router
from app.api.missions import router as missions_router
from app.api.robots import router as robots_router

api_router = APIRouter(prefix="/api")
api_router.include_router(health_router)
api_router.include_router(robots_router)
api_router.include_router(commands_router)
api_router.include_router(missions_router)
api_router.include_router(ai_router)
api_router.include_router(autonomy_router)
