from fastapi.testclient import TestClient

from app.main import app
from conftest import (
    TEST_KNOWLEDGE_VIDEO_ID,
    TEST_UNIFIED_KNOWLEDGE_UNIT_ID,
)


def _insert_tracking_link(database, short_id: str = "abc123xy") -> None:
    database.fetchval(
        """
        INSERT INTO tracking_links (
            short_id,
            request_id,
            result_rank,
            unit_id,
            video_id,
            target_url
        )
        VALUES ($1, $2, $3, $4::uuid, $5::uuid, $6)
        RETURNING short_id
        """,
        short_id,
        "req_trackingtest000000000000",
        0,
        TEST_UNIFIED_KNOWLEDGE_UNIT_ID,
        TEST_KNOWLEDGE_VIDEO_ID,
        "https://www.youtube.com/watch?v=openai-devday&t=120",
    )


def test_tracking_redirect_records_event_and_redirects(database) -> None:
    _insert_tracking_link(database)

    with TestClient(app) as client:
        response = client.get("/v/abc123xy", follow_redirects=False)

    assert response.status_code == 302
    assert response.headers["location"] == "https://www.youtube.com/watch?v=openai-devday&t=120"
    assert database.fetchval(
        "SELECT event_type FROM tracking_events WHERE short_id = $1 ORDER BY id DESC LIMIT 1",
        "abc123xy",
    ) == "redirect"


def test_tracking_detail_records_page_view(database) -> None:
    _insert_tracking_link(database, short_id="detail123")

    with TestClient(app) as client:
        response = client.get("/v/detail123/detail")

    assert response.status_code == 200
    assert "OpenAI Dev Day Keynote" in response.text
    assert database.fetchval(
        "SELECT event_type FROM tracking_events WHERE short_id = $1 ORDER BY id DESC LIMIT 1",
        "detail123",
    ) == "page_view"


def test_tracking_go_records_outbound_click(database) -> None:
    _insert_tracking_link(database, short_id="go123abc")

    with TestClient(app) as client:
        response = client.get("/v/go123abc/go", follow_redirects=False)

    assert response.status_code == 302
    assert response.headers["location"] == "https://www.youtube.com/watch?v=openai-devday&t=120"
    assert database.fetchval(
        "SELECT event_type FROM tracking_events WHERE short_id = $1 ORDER BY id DESC LIMIT 1",
        "go123abc",
    ) == "outbound_click"


def test_tracking_not_found_returns_branded_404() -> None:
    with TestClient(app) as client:
        response = client.get("/v/missing999")

    assert response.status_code == 404
    assert "Cerul tracking link not found." in response.text
