export interface Env {
  CF_ACCOUNT_ID: string;
  CF_GATEWAY_ID: string;
  UPSTREAM_TIMEOUT_MS?: string;
}

const SKIP_AUTH_HEADER = "x-aig-skip-provider-authorization";
const AIG_AUTH_HEADER = "cf-aig-authorization";

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function errorResponse(message: string, status: number, type = "invalid_request_error"): Response {
  return jsonResponse(
    {
      error: {
        message,
        type,
      },
    },
    status,
  );
}

function isTruthyHeader(value: string | null): boolean {
  if (!value) {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function missingConfigVars(env: Env): string[] {
  const missing: string[] = [];

  if (!env.CF_ACCOUNT_ID) {
    missing.push("CF_ACCOUNT_ID");
  }

  if (!env.CF_GATEWAY_ID) {
    missing.push("CF_GATEWAY_ID");
  }

  return missing;
}

function buildGatewayUrl(env: Env): string {
  if (missingConfigVars(env).length > 0) {
    throw new Error("Missing CF_ACCOUNT_ID or CF_GATEWAY_ID");
  }

  return `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.CF_GATEWAY_ID}/compat/chat/completions`;
}

function validateChatBody(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "Request body must be a JSON object";
  }

  const record = body as Record<string, unknown>;

  if (typeof record.model !== "string" || record.model.length === 0) {
    return "Missing required field: model";
  }

  if (!Array.isArray(record.messages)) {
    return "Missing required field: messages";
  }

  return null;
}

function buildOutboundHeaders(req: Request): Headers | Response {
  const outbound = new Headers(req.headers);

  if (!outbound.get(AIG_AUTH_HEADER)) {
    return errorResponse(`Missing required header: ${AIG_AUTH_HEADER}`, 401);
  }

  const shouldSkipProviderAuth = isTruthyHeader(outbound.get(SKIP_AUTH_HEADER));

  for (const header of [
    "host",
    "content-length",
    "cf-connecting-ip",
    "cf-ipcountry",
    "cf-ray",
    "x-forwarded-proto",
    "x-real-ip",
  ]) {
    outbound.delete(header);
  }

  outbound.delete(SKIP_AUTH_HEADER);

  if (shouldSkipProviderAuth) {
    outbound.delete("authorization");
  }

  outbound.set("accept-encoding", "identity");
  outbound.set("content-type", "application/json");

  return outbound;
}

function normalizeUpstreamResponse(upstreamResp: Response): {
  body: ReadableStream<Uint8Array> | null;
  headers: Headers;
} {
  const headers = new Headers(upstreamResp.headers);
  const contentEncoding = headers.get("content-encoding")?.trim().toLowerCase() ?? null;

  if (contentEncoding) {
    headers.delete("content-encoding");
    headers.delete("content-length");
  }

  headers.delete("transfer-encoding");
  headers.set("cache-control", "no-store");

  return {
    body: upstreamResp.body,
    headers,
  };
}

async function parseJson(req: Request): Promise<unknown | Response> {
  try {
    return await req.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }
}

async function handleChat(req: Request, env: Env): Promise<Response> {
  const headers = buildOutboundHeaders(req);
  if (headers instanceof Response) {
    return headers;
  }

  const contentType = req.headers.get("content-type");
  if (!contentType?.toLowerCase().includes("application/json")) {
    return errorResponse("Content-Type must be application/json", 400);
  }

  const body = await parseJson(req);
  if (body instanceof Response) {
    return body;
  }

  const validationError = validateChatBody(body);
  if (validationError) {
    return errorResponse(validationError, 400);
  }

  let upstreamUrl: string;
  try {
    upstreamUrl = buildGatewayUrl(env);
  } catch {
    const missing = missingConfigVars(env);
    const suffix = missing.length > 0 ? `: ${missing.join(", ")}` : "";
    return errorResponse(`Worker is missing required Cloudflare AI Gateway configuration${suffix}`, 500, "server_error");
  }

  const timeoutMs = Number(env.UPSTREAM_TIMEOUT_MS ?? "60000");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) ? timeoutMs : 60000);

  try {
    const upstreamResp = await fetch(upstreamUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const normalizedResp = normalizeUpstreamResponse(upstreamResp);

    return new Response(normalizedResp.body, {
      status: upstreamResp.status,
      statusText: upstreamResp.statusText,
      headers: normalizedResp.headers,
    });
  } catch (err) {
    const isAbort = err instanceof DOMException && err.name === "AbortError";

    return errorResponse(
      isAbort ? "Upstream request timed out" : "Failed to reach AI Gateway",
      isAbort ? 504 : 502,
      "api_connection_error",
    );
  } finally {
    clearTimeout(timeout);
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/healthz") {
      const missing = missingConfigVars(env);

      if (missing.length > 0) {
        return jsonResponse({ ok: false, configured: false, missing }, 500);
      }

      return jsonResponse({ ok: true, configured: true });
    }

    if (url.pathname === "/v1/chat/completions") {
      if (req.method !== "POST") {
        return errorResponse("Method not allowed", 405);
      }

      return handleChat(req, env);
    }

    return errorResponse("Not found", 404);
  },
};
