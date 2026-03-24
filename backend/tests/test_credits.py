import asyncio

import asyncpg

from app.billing.credits import current_billing_period, deduct_credits

TEST_USER_ID = "user_stub"
TEST_API_KEY_ID = "00000000-0000-0000-0000-000000000001"


def test_deduct_credits_returns_expected_costs(database) -> None:
    async def run_test() -> None:
        db = await asyncpg.connect(database.database_url)

        try:
            broll_credits = await deduct_credits(
                db,
                TEST_USER_ID,
                TEST_API_KEY_ID,
                "req_aaaaaaaaaaaaaaaaaaaaaaaa",
                "broll",
                False,
            )
            knowledge_credits = await deduct_credits(
                db,
                TEST_USER_ID,
                TEST_API_KEY_ID,
                "req_bbbbbbbbbbbbbbbbbbbbbbbb",
                "knowledge",
                False,
            )
            answered_credits = await deduct_credits(
                db,
                TEST_USER_ID,
                TEST_API_KEY_ID,
                "req_cccccccccccccccccccccccc",
                "knowledge",
                True,
            )

            assert broll_credits == 1
            assert knowledge_credits == 1
            assert answered_credits == 2
        finally:
            await db.close()

    asyncio.run(run_test())


def test_deduct_credits_is_idempotent_per_request_id(database) -> None:
    async def run_test() -> None:
        db = await asyncpg.connect(database.database_url)
        period_start, period_end = current_billing_period()

        try:
            first_charge = await deduct_credits(
                db,
                TEST_USER_ID,
                TEST_API_KEY_ID,
                "req_dddddddddddddddddddddddd",
                "knowledge",
                True,
            )
            second_charge = await deduct_credits(
                db,
                TEST_USER_ID,
                TEST_API_KEY_ID,
                "req_dddddddddddddddddddddddd",
                "knowledge",
                True,
            )

            assert first_charge == 2
            assert second_charge == 2
            assert (
                await database.fetchval_async(
                    """
                    SELECT credits_used
                    FROM usage_monthly
                    WHERE user_id = $1
                      AND period_start = $2
                      AND period_end = $3
                    """,
                    TEST_USER_ID,
                    period_start,
                    period_end,
                )
                == 2
            )
            assert await database.fetchval_async("SELECT COUNT(*) FROM usage_events") == 1
        finally:
            await db.close()

    asyncio.run(run_test())
