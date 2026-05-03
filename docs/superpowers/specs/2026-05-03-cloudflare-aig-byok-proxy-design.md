# Cloudflare AI Gateway BYOK Proxy Design

## Goal

Create a standalone Cloudflare Worker that accepts OpenAI-compatible chat completion requests and forwards them to Cloudflare AI Gateway while preserving `cf-aig-authorization` and conditionally stripping provider `Authorization` for BYOK.

## Architecture

The Worker exposes `GET /healthz` and `POST /v1/chat/completions`. The chat handler validates the JSON body, validates the required `cf-aig-authorization` header, builds sanitized outbound headers, and proxies the request to Cloudflare AI Gateway's compatible chat completions endpoint:

```text
https://gateway.ai.cloudflare.com/v1/{CF_ACCOUNT_ID}/{CF_GATEWAY_ID}/compat/chat/completions
```

Configuration comes from Worker vars:

- `CF_ACCOUNT_ID`
- `CF_GATEWAY_ID`
- `UPSTREAM_TIMEOUT_MS`, optional, default `60000`

## Header Behavior

The Worker treats `x-aig-skip-provider-authorization` as an internal control header. Truthy values are `true`, `1`, `yes`, and `on`, matched case-insensitively after trimming whitespace.

When the control header is truthy, the Worker removes outbound `Authorization` and preserves `cf-aig-authorization`. When the control header is absent or falsy, the Worker forwards `Authorization` unchanged. The Worker removes hop-by-hop and Cloudflare visitor metadata headers before forwarding and never forwards the custom control header upstream.

`cf-aig-byok-alias` is forwarded unchanged when supplied.

## Validation And Errors

The Worker requires JSON, `model` as a string, and `messages` as an array. Invalid JSON and body validation errors return OpenAI-style JSON errors with status `400`. Missing `cf-aig-authorization` returns `401`. Unsupported methods on `/v1/chat/completions` return `405`; unknown paths return `404`.

Upstream responses are passed through with status, headers, and body. Catastrophic fetch failures return `502`; upstream timeouts return `504`.

## Tests

Vitest tests exercise the Worker through its exported `fetch` handler and mock `globalThis.fetch` for upstream calls. Tests cover health checks, routing errors, body validation, missing gateway auth, BYOK authorization stripping, default authorization forwarding, alias preservation, upstream pass-through, and timeout/fetch failure handling.

## Documentation

The README documents configuration, local development, deployment, request examples, and the exact header contract. It avoids including any real secrets.
