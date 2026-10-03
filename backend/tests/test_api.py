import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.config import Settings, get_settings
from app.main import app

TOKEN = "test-token"
HEADERS = {"X-API-Token": TOKEN}


@pytest_asyncio.fixture
async def client():
    # Never let the developer's real .env decide whether auth passes.
    app.dependency_overrides[get_settings] = lambda: Settings(
        API_TOKEN=TOKEN,
        MODERATION_MODE="lexicon",
    )
    get_settings.cache_clear()
    transport = ASGITransport(app=app)
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            yield c
    finally:
        app.dependency_overrides.clear()
        get_settings.cache_clear()


@pytest.mark.asyncio
async def test_health_is_public(client: AsyncClient) -> None:
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_moderate_requires_token(client: AsyncClient) -> None:
    response = await client.post("/moderate", json={"content": "hello"})
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_moderate_rejects_bad_token(client: AsyncClient) -> None:
    response = await client.post(
        "/moderate", json={"content": "hello"}, headers={"X-API-Token": "wrong"}
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_moderate_allows_benign(client: AsyncClient) -> None:
    response = await client.post(
        "/moderate", json={"content": "day 12, feeling good"}, headers=HEADERS
    )
    assert response.status_code == 200
    body = response.json()
    assert body["decision"] == "allow"
    assert body["engine"] == "lexicon"
    assert body["request_id"]
    assert body["latency_ms"] >= 0


@pytest.mark.asyncio
async def test_moderate_blocks_explicit(client: AsyncClient) -> None:
    response = await client.post(
        "/moderate", json={"content": "everyone watches porn, stop pretending"}, headers=HEADERS
    )
    assert response.json()["decision"] == "block"
    assert response.json()["severity"] == "warning"


@pytest.mark.asyncio
async def test_moderate_rejects_empty(client: AsyncClient) -> None:
    response = await client.post("/moderate", json={"content": "   "}, headers=HEADERS)
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_moderate_rejects_too_long(client: AsyncClient) -> None:
    response = await client.post(
        "/moderate", json={"content": "a" * 2001}, headers=HEADERS
    )
    assert response.status_code == 413


@pytest.mark.asyncio
async def test_moderate_validation_error(client: AsyncClient) -> None:
    response = await client.post("/moderate", json={}, headers=HEADERS)
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_panic_returns_tiered_response(client: AsyncClient) -> None:
    response = await client.post(
        "/panic",
        json={"urge_level": 9, "preference_type": "islamic", "current_streak": 21},
        headers=HEADERS,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["escalate_to_admins"] is True
    assert len(body["steps"]) >= 3
    assert body["cache_key"]


@pytest.mark.asyncio
async def test_panic_requires_token(client: AsyncClient) -> None:
    response = await client.post("/panic", json={"urge_level": 5})
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_panic_rejects_out_of_range(client: AsyncClient) -> None:
    response = await client.post(
        "/panic", json={"urge_level": 99}, headers=HEADERS
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_openai_disabled_in_tests(client: AsyncClient) -> None:
    body = (await client.get("/health")).json()
    assert body["openai_enabled"] is False
    assert body["moderation_mode"] == "lexicon"