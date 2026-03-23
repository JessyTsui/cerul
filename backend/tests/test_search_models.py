from pydantic import ValidationError
import pytest

from app.billing.credits import calculate_credit_cost
from app.search.models import SearchImageInput, SearchRequest


def test_search_request_requires_query_or_image() -> None:
    with pytest.raises(ValidationError):
        SearchRequest.model_validate({})


def test_search_request_accepts_image_only() -> None:
    payload = SearchRequest.model_validate(
        {
            "image": {
                "url": "https://example.com/query.jpg",
            }
        }
    )

    assert payload.query is None
    assert str(payload.image.url) == "https://example.com/query.jpg"


def test_search_request_accepts_query_and_image() -> None:
    payload = SearchRequest.model_validate(
        {
            "query": "fireplace interview",
            "image": {
                "base64": "aGVsbG8=",
            },
        }
    )

    assert payload.query == "fireplace interview"
    assert payload.image.base64 == "aGVsbG8="


def test_search_image_input_requires_single_source() -> None:
    with pytest.raises(ValidationError):
        SearchImageInput.model_validate(
            {
                "url": "https://example.com/query.jpg",
                "base64": "aGVsbG8=",
            }
        )


def test_search_request_rejects_legacy_search_type_field() -> None:
    with pytest.raises(ValidationError):
        SearchRequest.model_validate(
            {
                "query": "cinematic drone shot",
                "search_type": "broll",
            }
        )


def test_search_request_enforces_max_results_bounds() -> None:
    with pytest.raises(ValidationError):
        SearchRequest.model_validate(
            {
                "query": "cinematic drone shot",
                "max_results": 0,
            }
        )

    with pytest.raises(ValidationError):
        SearchRequest.model_validate(
            {
                "query": "cinematic drone shot",
                "max_results": 51,
            }
        )


def test_search_request_rejects_invalid_filter_range() -> None:
    with pytest.raises(ValidationError):
        SearchRequest.model_validate(
            {
                "query": "cinematic drone shot",
                "filters": {
                    "min_duration": 30,
                    "max_duration": 10,
                },
            }
        )


def test_search_request_defaults_to_embedding_mode_without_summary() -> None:
    payload = SearchRequest.model_validate(
        {
            "query": "cinematic drone shot",
        }
    )

    assert payload.ranking_mode == "embedding"
    assert payload.include_summary is False
    assert payload.include_answer is False


@pytest.mark.parametrize(
    ("search_type", "include_answer", "expected_credits"),
    [
        ("unified", False, 1),
        ("unified", True, 2),
        ("knowledge", False, 1),
        ("broll", False, 1),
    ],
)
def test_credit_costs_match_unified_pricing(
    search_type: str,
    include_answer: bool,
    expected_credits: int,
) -> None:
    assert calculate_credit_cost(search_type, include_answer) == expected_credits
