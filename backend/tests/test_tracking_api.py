from fastapi.testclient import TestClient

from app.main import app
import app.routers.tracking as tracking_router
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
            target_url,
            title,
            thumbnail_url,
            source,
            speaker,
            unit_type,
            timestamp_start,
            timestamp_end,
            transcript,
            visual_desc,
            keyframe_url
        )
        VALUES (
            $1,
            $2,
            $3,
            $4::uuid,
            $5::uuid,
            $6,
            'OpenAI Dev Day Keynote',
            'https://img.youtube.com/vi/openai-devday/hqdefault.jpg',
            'youtube',
            'Sam Altman',
            'speech',
            120,
            178.5,
            'Agents can use reasoning models to plan and execute tasks more reliably.',
            'Speaker on stage in front of a conference screen.',
            'https://cdn.cerul.ai/frames/openai-devday/000.jpg'
        )
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


def test_tracking_snippet_prefers_transcript_for_merged_visual_results() -> None:
    snippet = tracking_router._build_snippet(
        {
            "unit_type": "visual",
            "transcript": "The rocket clears the tower as the countdown hits zero.",
            "visual_desc": "A rocket lifts off in a bright plume of smoke and flame.",
        }
    )

    assert snippet == "The rocket clears the tower as the countdown hits zero."


def test_tracking_links_keep_working_after_video_and_unit_are_removed(database) -> None:
    _insert_tracking_link(database, short_id="persist123")
    database.fetchval(
        """
        DELETE FROM retrieval_units
        WHERE id = $1::uuid
        RETURNING id::text
        """,
        TEST_UNIFIED_KNOWLEDGE_UNIT_ID,
    )
    database.fetchval(
        """
        DELETE FROM videos
        WHERE id = $1::uuid
        RETURNING id::text
        """,
        TEST_KNOWLEDGE_VIDEO_ID,
    )

    with TestClient(app) as client:
        redirect_response = client.get("/v/persist123", follow_redirects=False)
        detail_response = client.get("/v/persist123/detail")

    assert redirect_response.status_code == 302
    assert (
        redirect_response.headers["location"]
        == "https://www.youtube.com/watch?v=openai-devday&t=120"
    )
    assert detail_response.status_code == 200
    assert "OpenAI Dev Day Keynote" in detail_response.text
