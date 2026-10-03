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
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=False,
    allow_methods=["POST", "GET"],
    allow_headers=["Content-Type", "X-API-Token"],
)

app.include_router(health.router)
app.include_router(moderation.router)
app.include_router(panic.router)