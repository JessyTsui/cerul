# Public API Error Reference

This file is the source copy for public error-handling docs. Publish it alongside `openapi.yaml` so users and agents can self-diagnose failed API calls.

## Response shape

All public `/v1` errors use the same JSON envelope:

```json
{
  "error": {
    "code": "forbidden",
    "subcode": "insufficient_credits",
    "message": "Insufficient credits for this request",
    "request_id": "req_9f8c1d5b2a9f7d1a8c4e6b02"
  }
}
```

`error.subcode` is optional. For machine branching, prefer `error.subcode` when present and fall back to `error.code` otherwise.

Public `/v1` responses also include an `x-request-id` header. Use that value in logs and support tickets. Authentication failures include `WWW-Authenticate: Bearer`, and rate limits include `Retry-After`.

## Machine branch key

Use:

```text
error.subcode ?? error.code
```

This preserves backward compatibility for existing clients that only know the coarse `error.code`, while giving newer clients and agents a stable fine-grained key.

## Subcodes

### auth

| subcode | coarse code | HTTP | trigger | agent action |
| --- | --- | --- | --- | --- |
| `missing_authorization` | `unauthorized` | `401` | No `Authorization` header on a `/v1/*` request | Add `Authorization: Bearer cerul_...` and retry |
| `invalid_authorization_header` | `unauthorized` | `401` | Malformed authorization header, including non-Bearer or empty Bearer token | Fix the header format before retrying |
| `malformed_api_key` | `unauthorized` | `401` | API key fails format validation | Check the key copy/paste and prefix |
| `invalid_api_key` | `unauthorized` | `401` | API key format passes but the key is unknown | Regenerate the key in the dashboard |
| `api_key_inactive` | `forbidden` | `403` | API key was revoked or deactivated | Regenerate or reactivate the key |

### billing

| subcode | coarse code | HTTP | trigger | agent action |
| --- | --- | --- | --- | --- |
| `billing_hold` | `forbidden` | `403` | Account is under billing review | Surface the problem to the human user and contact support |
| `insufficient_credits` | `forbidden` | `403` | Wallet balance is below request cost | Call `GET /v1/usage`, show the remaining balance, and ask the user to top up |

### rate limit

| subcode | coarse code | HTTP | trigger | agent action |
| --- | --- | --- | --- | --- |
| `rate_limit_exceeded` | `rate_limited` | `429` | Request rate exceeded the current account/key limit | Wait `Retry-After` seconds plus jitter, then retry |

### invalid request

| subcode | coarse code | HTTP | trigger | agent action |
| --- | --- | --- | --- | --- |
| `invalid_image` | `invalid_request` | `422` | Search image could not be decoded, downloaded, or is unsupported | Fix the image input; text-only search can still work |

## Coarse-only responses

These responses currently do not emit a dedicated `subcode`.

| code | HTTP | when | agent action |
| --- | --- | --- | --- |
| `invalid_request` | `400` | Generic schema or validation failure | Fix the request body and do not retry unchanged |
| `not_found` | `404` | Unknown `/v1/*` path or a future resource miss | Verify the path or identifier before retrying |
| `internal_error` | `500` | Unhandled internal failure | Retry with bounded exponential backoff and include `request_id` if it repeats |

## Endpoint matrix

| Endpoint | Success | Coarse codes | Possible subcodes |
| --- | --- | --- | --- |
| `POST /v1/search` | `200` | `invalid_request`, `unauthorized`, `forbidden`, `rate_limited`, `internal_error` | `missing_authorization`, `invalid_authorization_header`, `malformed_api_key`, `invalid_api_key`, `api_key_inactive`, `billing_hold`, `insufficient_credits`, `rate_limit_exceeded`, `invalid_image` |
| `GET /v1/usage` | `200` | `unauthorized`, `forbidden`, `rate_limited`, `internal_error` | `missing_authorization`, `invalid_authorization_header`, `malformed_api_key`, `invalid_api_key`, `api_key_inactive`, `billing_hold`, `rate_limit_exceeded` |
| Any unknown `/v1/*` path | none | `not_found` | none |

## Search-specific `invalid_image` examples

- `Unsupported image type: image/gif`
- `Invalid base64 image payload`
- `Failed to download image: 404`
- `Image too large: 12582912 bytes (max 10485760)`

## Recommended agent behavior

1. Compute a branch key as `error.subcode ?? error.code`.
2. Persist `error.request_id` and the `x-request-id` header in logs.
3. Only auto-retry `rate_limit_exceeded`, `rate_limited`, and `internal_error`.
4. For auth and billing failures, stop retrying and ask for corrected credentials or human action.
5. For `invalid_request` and `invalid_image`, repair the request before retrying.

## Publishing note

This repository already treats `openapi.yaml` as the API contract source of truth. Keep this error reference aligned with the OpenAPI file and publish both to the public docs surface instead of maintaining a separate runtime-only error catalog endpoint.
