# New User Experience & Credit Adjustment Plan

## Background

New users currently receive 1,100 spendable credits upon registration (1,000 monthly included + 100 signup bonus), which is too generous. This plan adjusts credit allocation to be more sustainable, and rebalances referral rewards to better incentivize invitations.

## Current State

| Item | Value |
|------|-------|
| Monthly included credits (free tier) | 1,000 |
| Signup bonus (all users) | 100 |
| Referral bonus — invitee | 100 |
| Referral bonus — inviter | 100 |
| Daily free uses | 10 |

**Current day-1 credits (no invite code):** 1,000 + 100 + 10 = 1,110
**Current day-1 credits (with invite code):** 1,000 + 100 + 100 + 10 = 1,210

## Target State

| Item | Current | New |
|------|---------|-----|
| Monthly included credits (free tier) | 1,000 | **300 (requires credit card)** |
| Signup bonus (all users) | 100 | **100 (unchanged)** |
| Referral bonus — invitee | 100 | **100 (unchanged)** |
| Referral bonus — inviter | 100 | **200** |
| Daily free uses | 10 | 10 (unchanged) |

**New day-1 credits (no invite code):** 100 (signup) + 10 (daily) = 110
**New day-1 credits (with invite code):** 100 (signup) + 100 (referral) + 10 (daily) = **210**
**After binding credit card (monthly):** +300 per month

## Changes Required

### 1. Adjust monthly included credits for free tier: 1,000 → 300, gated by credit card
- Database: `user_profiles.monthly_credit_limit` default value `1000` → `300`
- **Key change:** Monthly credits are NOT granted on registration. Only start granting after user has bound a credit card (payment method on file)
- Billing service: `ensureCurrentPeriodGrant()` — add a check: skip grant if user has no payment method bound
- The first monthly grant starts from the month the credit card is bound (not retroactive)
- Need a migration to update default and existing free-tier users' `monthly_credit_limit`

### 2. Increase inviter referral bonus: 100 → 200
- Split `REFERRAL_BONUS_CREDITS` into two separate constants:
  - `REFERRAL_INVITEE_BONUS = 100`
  - `REFERRAL_INVITER_BONUS = 200`
- Update `redeemReferralCode()` in `api/src/services/billing.ts` to use different amounts for referrer vs referee

### 3. Auto-create default API key for new users

New users should automatically receive a default API key upon registration, so they can start using the API immediately without manual setup.

- In the user registration hook (same place that grants signup bonus), auto-generate an API key
- Key name: `"Default"`
- The raw key is shown only once — store the SHA256 hash as usual
- The raw key should be visible in the dashboard on first login (or at least copyable from the API keys page)

### 4. Fix API key management UI

The API keys management page has two UI issues:

**a) Eye icon (reveal key) is broken:**
- Clicking the eye icon should reveal the full API key plaintext temporarily
- After a few seconds (e.g. 3-5s), it should auto-hide back to the masked format
- This was previously implemented but is no longer working

**b) Missing copy button:**
- Add a copy-to-clipboard icon/button for each API key
- Position: before the delete button
- On click: copy the key to clipboard and show brief feedback (e.g. tooltip "Copied!")

### 5. API Playground UI improvements

**a) Send button loading state:**
- Rename "Send request" → "Send"
- While request is in flight, show a spinning loader on the button (disable button to prevent duplicate requests)
- On completion, restore button to normal state

**b) Refactor code snippets to use official SDKs:**

Current state: all language tabs (Python, JS, Shell, Go) generate raw HTTP requests to `/v1/search`.

Target: Python and JS should use official SDK packages. Go stays as raw HTTP (no SDK yet). Shell (curl) unchanged.

**Python** — use `cerul` PyPI package:
```python
from cerul import Cerul

client = Cerul(api_key="YOUR_API_KEY")
result = client.search(query="...", max_results=5)

for r in result:
    print(r.title, r.url)
```

**JavaScript** — use `cerul` npm package:
```javascript
import { cerul } from "cerul";

const client = cerul({ apiKey: "YOUR_API_KEY" });
const result = await client.search({
  query: "...",
  max_results: 5,
});

for (const r of result.results) {
  console.log(r.title, r.url);
}
```

**Go** — keep raw HTTP request (no SDK available)

**Shell (curl)** — keep as-is

## Files to Modify

| File | Change |
|------|--------|
| `api/src/services/billing-catalog.ts` | Add `REFERRAL_INVITEE_BONUS`, `REFERRAL_INVITER_BONUS`; remove or keep `REFERRAL_BONUS_CREDITS` |
| `api/src/services/billing.ts` | Split referral bonus amounts for inviter/invitee; handle 0 monthly credits |
| `db/migrations/XXX_adjust_credits.sql` | New migration: update `monthly_credit_limit` default to 0 and existing free-tier values |
| `frontend/lib/auth-db.ts` or `auth-server.ts` | Auto-create default API key in user registration hook |
| API key creation service | Ensure key generation logic can be called from registration flow |
| API keys management UI component | Fix eye icon reveal/auto-hide; add copy button before delete |
| `frontend/components/dashboard/playground-screen.tsx` | Rename button, add loading spinner, refactor Python/JS snippets to use SDK |
