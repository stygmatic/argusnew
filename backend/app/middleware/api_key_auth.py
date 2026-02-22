from __future__ import annotations

from fastapi import Header, HTTPException

from app.config import settings


async def require_api_key(x_api_key: str = Header(...)) -> str:
    """FastAPI dependency that validates the X-API-Key header."""
    if not settings.voice_api_key:
        raise HTTPException(status_code=503, detail="Voice API key not configured on server")
    if x_api_key != settings.voice_api_key:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return x_api_key
