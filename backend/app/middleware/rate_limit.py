"""Simple in-memory rate limiter for API endpoints."""

from __future__ import annotations

import time
from collections import defaultdict

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

# Max requests per window per IP
MAX_REQUESTS = 120
WINDOW_SECONDS = 60


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Token-bucket-style rate limiter keyed by client IP.

    Only applies to /api/ routes (skips /ws, static assets, health).
    """

    def __init__(self, app, max_requests: int = MAX_REQUESTS, window: int = WINDOW_SECONDS):  # type: ignore[no-untyped-def]
        super().__init__(app)
        self.max_requests = max_requests
        self.window = window
        self._buckets: dict[str, list[float]] = defaultdict(list)

    async def dispatch(self, request: Request, call_next):  # type: ignore[no-untyped-def]
        path = request.url.path

        # Don't rate-limit health, websocket, or static assets
        if not path.startswith("/api/") or path.startswith("/api/health"):
            return await call_next(request)

        client_ip = request.client.host if request.client else "unknown"
        now = time.monotonic()

        # Prune old entries
        bucket = self._buckets[client_ip]
        cutoff = now - self.window
        self._buckets[client_ip] = bucket = [t for t in bucket if t > cutoff]

        if len(bucket) >= self.max_requests:
            return JSONResponse(
                {"error": "Rate limit exceeded. Try again later."},
                status_code=429,
                headers={"Retry-After": str(self.window)},
            )

        bucket.append(now)
        return await call_next(request)
