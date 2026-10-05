"""FastAPI application entrypoint."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.config import get_settings
from app.moderation import engine
from app.routers import health, moderation, panic

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await engine.warm_up()
    yield


app = FastAPI(
    title="Steadfast Moderation Service",
    version=__version__,
    description=(
        "Async NLP moderation for the Steadfast recovery community, plus the "
        "panic button responder. Internal API: requires X-API-Token."
    ),
    lifespan=lifespan,
    docs_url="/docs" if settings.docs_enabled else None,
    redoc_url=None,
    openapi_url="/openapi.json" if settings.docs_enabled else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=False,
    allow_methods=["POST", "GET"],
    allow_headers=["Content-Type", "X-API-Token"],
)

ROUTERS = (health.router, moderation.router, panic.router)

for router in ROUTERS:
    # Root paths are what uvicorn serves locally (Docker) and what the
    # Next.js client expects.
    app.include_router(router)
    # Vercel mounts every function under /api, and a rewrite updates the URI
    # before Mangum builds the ASGI scope, so the app has to answer the
    # prefixed paths too or every request lands on a 404.
    app.include_router(router, prefix="/api")