import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/index";

const env: Env = {
  CF_ACCOUNT_ID: "account-123",
  CF_GATEWAY_ID: "gateway-abc",
  UPSTREAM_TIMEOUT_MS: "1000",
};

function jsonRequest(headers: HeadersInit = {}, body: unknown = validBody()): Request {
  return new Request("https://proxy.example.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function validBody(): unknown {
  return {
    model: "openai/gpt-5.2",
    messages: [{ role: "user", content: "Hello" }],
  };
}

async function readJson(resp: Response): Promise<unknown> {
  return resp.json();
}

describe("Cloudflare AI Gateway BYOK proxy", () => {
  let upstreamFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    upstreamFetch = vi.fn(async () => {
      return new Response(JSON.stringify({ id: "chatcmpl_test" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    vi.stubGlobal("fetch", upstreamFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns health status without calling upstream", async () => {
    const resp = await worker.fetch(new Request("https://proxy.example.com/healthz"), env);

    expect(resp.status).toBe(200);
    expect(await readJson(resp)).toEqual({ ok: true, configured: true });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("reports missing runtime configuration on health checks", async () => {
    const resp = await worker.fetch(new Request("https://proxy.example.com/healthz"), {
      CF_ACCOUNT_ID: "",
      CF_GATEWAY_ID: "",
      UPSTREAM_TIMEOUT_MS: "1000",
    });

    expect(resp.status).toBe(500);
    expect(await readJson(resp)).toEqual({
      ok: false,
      configured: false,
      missing: ["CF_ACCOUNT_ID", "CF_GATEWAY_ID"],
    });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("rejects chat requests missing cf-aig-authorization", async () => {
    const resp = await worker.fetch(jsonRequest(), env);

    expect(resp.status).toBe(401);
    expect(await readJson(resp)).toEqual({
      error: {
        message: "Missing required header: cf-aig-authorization",
        type: "invalid_request_error",
      },
    });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("rejects missing cf-aig-authorization before body validation", async () => {
    const req = new Request("https://proxy.example.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "not json",
    });

    const resp = await worker.fetch(req, env);

    expect(resp.status).toBe(401);
    expect(await readJson(resp)).toEqual({
      error: {
        message: "Missing required header: cf-aig-authorization",
        type: "invalid_request_error",
      },
    });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON bodies", async () => {
    const req = new Request("https://proxy.example.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-aig-authorization": "Bearer gateway-token",
      },
      body: "{not-json",
    });

    const resp = await worker.fetch(req, env);

    expect(resp.status).toBe(400);
    expect(await readJson(resp)).toEqual({
      error: {
        message: "Invalid JSON body",
        type: "invalid_request_error",
      },
    });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("rejects chat requests without an application/json content type", async () => {
    const req = new Request("https://proxy.example.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "text/plain",
        "cf-aig-authorization": "Bearer gateway-token",
      },
      body: JSON.stringify(validBody()),
    });

    const resp = await worker.fetch(req, env);

    expect(resp.status).toBe(400);
    expect(await readJson(resp)).toEqual({
      error: {
        message: "Content-Type must be application/json",
        type: "invalid_request_error",
      },
    });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("rejects chat bodies without model and messages", async () => {
    const missingModel = await worker.fetch(
      jsonRequest({ "cf-aig-authorization": "Bearer gateway-token" }, { messages: [] }),
      env,
    );
    const missingMessages = await worker.fetch(
      jsonRequest({ "cf-aig-authorization": "Bearer gateway-token" }, { model: "openai/gpt-5.2" }),
      env,
    );

    expect(missingModel.status).toBe(400);
    expect(await readJson(missingModel)).toMatchObject({
      error: { message: "Missing required field: model" },
    });
    expect(missingMessages.status).toBe(400);
    expect(await readJson(missingMessages)).toMatchObject({
      error: { message: "Missing required field: messages" },
    });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("strips provider authorization only when the custom header is truthy", async () => {
    const req = jsonRequest({
      authorization: "Bearer provider-placeholder",
      "cf-aig-authorization": "Bearer gateway-token",
      "cf-aig-byok-alias": "production",
      "x-aig-skip-provider-authorization": " YES ",
    });

    const resp = await worker.fetch(req, env);

    expect(resp.status).toBe(200);
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    const [url, init] = upstreamFetch.mock.calls[0];
    const headers = new Headers(init.headers);
    expect(url).toBe("https://gateway.ai.cloudflare.com/v1/account-123/gateway-abc/compat/chat/completions");
    expect(init.method).toBe("POST");
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("cf-aig-authorization")).toBe("Bearer gateway-token");
    expect(headers.get("cf-aig-byok-alias")).toBe("production");
    expect(headers.get("accept-encoding")).toBe("identity");
    expect(headers.get("x-aig-skip-provider-authorization")).toBeNull();
    expect(JSON.parse(String(init.body))).toEqual(validBody());
  });

  it("forwards provider authorization when the custom header is absent", async () => {
    const req = jsonRequest({
      authorization: "Bearer provider-key",
      "cf-aig-authorization": "Bearer gateway-token",
    });

    const resp = await worker.fetch(req, env);

    expect(resp.status).toBe(200);
    const [, init] = upstreamFetch.mock.calls[0];
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer provider-key");
    expect(headers.get("cf-aig-authorization")).toBe("Bearer gateway-token");
  });

  it("passes through upstream status, body, and response headers", async () => {
    upstreamFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: "rate limited" } }), {
        status: 429,
        statusText: "Too Many Requests",
        headers: { "content-type": "application/json", "x-request-id": "req_123" },
      }),
    );

    const resp = await worker.fetch(
      jsonRequest({ "cf-aig-authorization": "Bearer gateway-token" }),
      env,
    );

    expect(resp.status).toBe(429);
    expect(resp.headers.get("x-request-id")).toBe("req_123");
    expect(resp.headers.get("cache-control")).toBe("no-store");
    expect(await readJson(resp)).toEqual({ error: { message: "rate limited" } });
  });

  it("removes stale upstream compression headers from decoded response bodies", async () => {
    const upstreamBody = JSON.stringify({ id: "chatcmpl_gzip" });
    upstreamFetch.mockResolvedValueOnce(
      new Response(upstreamBody, {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-encoding": "gzip",
          "content-length": "999",
          "transfer-encoding": "chunked",
        },
      }),
    );

    const resp = await worker.fetch(
      jsonRequest({ "cf-aig-authorization": "Bearer gateway-token" }),
      env,
    );

    expect(resp.status).toBe(200);
    expect(resp.headers.get("content-encoding")).toBeNull();
    expect(resp.headers.get("content-length")).toBeNull();
    expect(await resp.text()).toBe(upstreamBody);
  });

  it("returns 502 for upstream fetch failures", async () => {
    upstreamFetch.mockRejectedValueOnce(new Error("network unavailable"));

    const resp = await worker.fetch(
      jsonRequest({ "cf-aig-authorization": "Bearer gateway-token" }),
      env,
    );

    expect(resp.status).toBe(502);
    expect(await readJson(resp)).toEqual({
      error: {
        message: "Failed to reach AI Gateway",
        type: "api_connection_error",
      },
    });
  });

  it("reports missing runtime configuration without exposing values", async () => {
    const resp = await worker.fetch(
      jsonRequest({ "cf-aig-authorization": "Bearer gateway-token" }),
      {
        CF_ACCOUNT_ID: "account-123",
        CF_GATEWAY_ID: "",
        UPSTREAM_TIMEOUT_MS: "1000",
      },
    );

    expect(resp.status).toBe(500);
    expect(await readJson(resp)).toEqual({
      error: {
        message: "Worker is missing required Cloudflare AI Gateway configuration: CF_GATEWAY_ID",
        type: "server_error",
      },
    });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("returns 504 for upstream abort failures", async () => {
    upstreamFetch.mockRejectedValueOnce(new DOMException("Timed out", "AbortError"));

    const resp = await worker.fetch(
      jsonRequest({ "cf-aig-authorization": "Bearer gateway-token" }),
      env,
    );

    expect(resp.status).toBe(504);
    expect(await readJson(resp)).toEqual({
      error: {
        message: "Upstream request timed out",
        type: "api_connection_error",
      },
    });
  });

  it("returns 405 for unsupported chat completion methods and 404 for unknown paths", async () => {
    const methodResp = await worker.fetch(
      new Request("https://proxy.example.com/v1/chat/completions", { method: "GET" }),
      env,
    );
    const notFoundResp = await worker.fetch(new Request("https://proxy.example.com/nope"), env);

    expect(methodResp.status).toBe(405);
    expect(notFoundResp.status).toBe(404);
  });
});
