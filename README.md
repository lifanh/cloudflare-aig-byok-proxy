# Cloudflare AI Gateway BYOK Authorization-Strip Proxy

A minimal Cloudflare Worker that exposes an OpenAI-compatible chat completions endpoint and forwards requests to Cloudflare AI Gateway.

The Worker is designed for clients that always send `Authorization`. When the client opts in with `x-aig-skip-provider-authorization: true`, the Worker removes provider `Authorization` before forwarding so AI Gateway BYOK can use the stored provider key. The Worker always preserves client-supplied `cf-aig-authorization`.

## Endpoints

- `GET /healthz`
- `POST /v1/chat/completions`

## Configuration

This project intentionally does not commit account-specific Worker vars in `wrangler.jsonc`.

For local development, create a private `.dev.vars` file from the example:

```sh
cp .dev.vars.example .dev.vars
```

Then edit `.dev.vars`:

```dotenv
CF_ACCOUNT_ID="your-cloudflare-account-id"
CF_GATEWAY_ID="default"
UPSTREAM_TIMEOUT_MS="60000"
```

For deployed Workers, set these as Worker environment variables in the Cloudflare dashboard or your deployment automation. `CF_ACCOUNT_ID` and `CF_GATEWAY_ID` are required. `UPSTREAM_TIMEOUT_MS` is optional and defaults to `60000`.

This Worker does not store or inject provider API keys or AI Gateway tokens. Clients must send `cf-aig-authorization`.

## Header Contract

Required:

- `cf-aig-authorization: Bearer <gateway-token>`
- `Content-Type: application/json`

Optional:

- `Authorization: Bearer <provider-key-or-placeholder>`
- `x-aig-skip-provider-authorization: true`
- `cf-aig-byok-alias: <alias>`

Truthy values for `x-aig-skip-provider-authorization` are `true`, `1`, `yes`, and `on`.

## Local Development

```sh
npm install
npm run dev
```

## Test

```sh
npm test
npm run typecheck
npm run build
```

## Deploy

Set `CF_ACCOUNT_ID` and `CF_GATEWAY_ID` for the target Worker environment, then run:

```sh
npm run deploy
```

## BYOK Strip Mode Example

```sh
curl -X POST "https://<worker-host>/v1/chat/completions" \
  -H "content-type: application/json" \
  -H "cf-aig-authorization: Bearer <gateway-token>" \
  -H "authorization: Bearer placeholder" \
  -H "x-aig-skip-provider-authorization: true" \
  -H "cf-aig-byok-alias: production" \
  -d '{
    "model": "openai/gpt-5.2",
    "messages": [
      { "role": "user", "content": "Hello" }
    ]
  }'
```

The upstream request preserves `cf-aig-authorization` and `cf-aig-byok-alias`, removes `Authorization`, and does not forward `x-aig-skip-provider-authorization`.

## Provider Authorization Forwarding Example

```sh
curl -X POST "https://<worker-host>/v1/chat/completions" \
  -H "content-type: application/json" \
  -H "cf-aig-authorization: Bearer <gateway-token>" \
  -H "authorization: Bearer <provider-key>" \
  -d '{
    "model": "openai/gpt-5.2",
    "messages": [
      { "role": "user", "content": "Hello" }
    ]
  }'
```

Without the custom skip header, the upstream request forwards `Authorization` unchanged.
