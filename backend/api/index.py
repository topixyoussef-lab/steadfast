"""Vercel serverless entrypoint.

Vercel's Python builder expects a handler it can call, and an ASGI app is not
one. Mangum adapts the Lambda event to ASGI so the same FastAPI app that uvicorn
serves locally is what runs in production.
"""
from mangum import Mangum

from app.main import app

handler = Mangum(app)
