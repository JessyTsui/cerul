from pydantic import ValidationError
import pytest

from app.billing.credits import calculate_credit_cost
from app.search.models import SearchRequest


def test_search_request_requires_query() -> None:
    with pytest.raises(ValidationError):
        SearchRequest.model_validate({"search_type": "broll"})


def test_search_request_rejects_invalid_search_type() -> None:
    with pytest.raises(ValidationError):
        SearchRequest.model_validate(
            {
                "query": "cinematic drone shot",
                "search_type": "clips",
            }
        )


def test_search_request_enforces_max_results_bounds() -> None:
    with pytest.raises(ValidationError):
        SearchRequest.model_validate(
            {
                "query": "cinematic drone shot",
                "search_type": "broll",
                "max_results": 0,
            }
        )

    with pytest.raises(ValidationError):
        SearchRequest.model_validate(
            {
                "query": "cinematic drone shot",
                "search_type": "broll",
                "max_results": 51,
            }
        )


def test_search_request_rejects_answer_for_broll() -> None:
    with pytest.raises(ValidationError):
        SearchRequest.model_validate(
            {
                "query": "cinematic drone shot",
                "search_type": "broll",
                "include_answer": True,
            }
        )


@pytest.mark.parametrize(
    ("search_type", "include_answer", "expected_credits"),
    [
        ("broll", False, 1),
        ("knowledge", False, 2),
        ("knowledge", True, 3),
    ],
)
def test_credit_costs_match_search_type(
    search_type: str,
    include_answer: bool,
    expected_credits: int,
) -> None:
    assert calculate_credit_cost(search_type, include_answer) == expected_credits
