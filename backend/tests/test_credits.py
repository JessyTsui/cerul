import asyncio

from app.billing.credits import current_billing_period, deduct_credits
from app.db import create_stub_database


def test_deduct_credits_returns_expected_costs() -> None:
    async def run_test() -> None:
        db = create_stub_database()

        broll_credits = await deduct_credits(
            db,
            "user_stub",
            "key_stub",
            "req_aaaaaaaaaaaaaaaaaaaaaaaa",
            "broll",
            False,
        )
        knowledge_credits = await deduct_credits(
            db,
            "user_stub",
            "key_stub",
            "req_bbbbbbbbbbbbbbbbbbbbbbbb",
            "knowledge",
            False,
        )
        answered_credits = await deduct_credits(
            db,
            "user_stub",
            "key_stub",
            "req_cccccccccccccccccccccccc",
            "knowledge",
            True,
        )

        assert broll_credits == 1
        assert knowledge_credits == 2
        assert answered_credits == 3

    asyncio.run(run_test())


def test_deduct_credits_is_idempotent_per_request_id() -> None:
    async def run_test() -> None:
        db = create_stub_database()
        period_start, period_end = current_billing_period()

        first_charge = await deduct_credits(
            db,
            "user_stub",
            "key_stub",
            "req_dddddddddddddddddddddddd",
            "knowledge",
            True,
        )
        second_charge = await deduct_credits(
            db,
            "user_stub",
            "key_stub",
            "req_dddddddddddddddddddddddd",
            "knowledge",
            True,
        )

        assert first_charge == 3
        assert second_charge == 3
        assert db.usage_monthly[("user_stub", period_start, period_end)]["credits_used"] == 3
        assert len(db.usage_events) == 1

    asyncio.run(run_test())
