import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { createOpenAICompatibleProxy, type OpenAIProxyOptions } from "./openai-compatible-proxy.js";

export type OpenAIProxyServerCorsOptions = {
  allowOrigin?: string;
  allowHeaders?: string;
  allowMethods?: string;
};

export type OpenAIProxyServerOptions = OpenAIProxyOptions & {
  cors?: OpenAIProxyServerCorsOptions;
  maxRequestBytes?: number;
  maxConcurrentRequests?: number;
  adminToken?: string;
};

export type OpenAIProxyServer = {
  server: Server;
  listen: (port?: number, host?: string) => Promise<{ port: number; host: string }>;
  close: () => Promise<void>;
};

async function readRequestBody(req: IncomingMessage, maxRequestBytes: number): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > maxRequestBytes) {
      throw new Error(`Request body exceeds limit (${maxRequestBytes} bytes).`);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function requestUrl(req: IncomingMessage): string {
  const host = req.headers.host || "localhost";
  const protocol = "http";
  return `${protocol}://${host}${req.url || "/"}`;
}

function toFetchHeaders(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
      continue;
    }
    if (typeof value === "string") {
      headers.set(key, value);
    }
  }
  return headers;
}

function resolveRequestId(headers: Headers): string {
  const existing = headers.get("x-request-id")?.trim();
  if (existing) {
    return existing;
  }
  const generated = randomUUID();
  headers.set("x-request-id", generated);
  return generated;
}

function resolveAdminToken(req: IncomingMessage): string | undefined {
  const header = req.headers["x-admin-token"];
  if (typeof header === "string" && header.trim()) {
    return header.trim();
  }
  const auth = req.headers.authorization;
  if (typeof auth === "string") {
    const match = auth.match(/^Bearer\s+(.+)$/i);
    const token = match?.[1]?.trim();
    if (token) {
      return token;
    }
  }
  return undefined;
}

function parseReloadAgentId(body: Uint8Array): string | undefined {
  if (body.length === 0) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body).toString("utf8"));
  } catch {
    throw new Error("Invalid JSON body for reload endpoint.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Reload body must be a JSON object.");
  }
  const candidate = (parsed as { agentId?: unknown }).agentId;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : undefined;
}

async function writeFetchResponse(response: Response, res: ServerResponse): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  if (!response.body) {
    res.end();
    return;
  }
  const reader = response.body.getReader();
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }
    if (!res.write(Buffer.from(chunk.value))) {
      await new Promise<void>((resolve) => res.once("drain", resolve));
    }
  }
  res.end();
}

function applyCorsHeaders(res: ServerResponse, cors?: OpenAIProxyServerCorsOptions): void {
  if (!cors) {
    return;
  }
  res.setHeader("access-control-allow-origin", cors.allowOrigin ?? "*");
  res.setHeader("access-control-allow-headers", cors.allowHeaders ?? "authorization,content-type,x-agent-id");
  res.setHeader("access-control-allow-methods", cors.allowMethods ?? "GET,POST,OPTIONS");
}

function applyRequestIdHeader(res: ServerResponse, requestId: string): void {
  res.setHeader("x-request-id", requestId);
}

export function createOpenAICompatibleProxyServer(options: OpenAIProxyServerOptions): OpenAIProxyServer {
  const proxy = createOpenAICompatibleProxy(options);
  const startedAt = Date.now();
  const maxRequestBytes = options.maxRequestBytes ?? 2 * 1024 * 1024;
  const maxConcurrentRequests = options.maxConcurrentRequests ?? 200;
  if (!Number.isFinite(maxRequestBytes) || maxRequestBytes <= 0) {
    throw new Error("maxRequestBytes must be a positive number.");
  }
  if (!Number.isFinite(maxConcurrentRequests) || maxConcurrentRequests <= 0) {
    throw new Error("maxConcurrentRequests must be a positive number.");
  }
  let activeRequests = 0;
  const server = createServer(async (req, res) => {
    const fetchHeaders = toFetchHeaders(req);
    const requestId = resolveRequestId(fetchHeaders);
    if (activeRequests >= Math.floor(maxConcurrentRequests)) {
      res.statusCode = 429;
      applyCorsHeaders(res, options.cors);
      applyRequestIdHeader(res, requestId);
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          error: {
            message: "Too many concurrent requests.",
            type: "rate_limit_error",
          },
        }),
      );
      return;
    }
    activeRequests += 1;
    try {
      if (req.method === "GET" && req.url === "/healthz") {
        res.statusCode = 200;
        applyCorsHeaders(res, options.cors);
        applyRequestIdHeader(res, requestId);
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            status: "ok",
            uptimeMs: Date.now() - startedAt,
            activeRequests,
            maxConcurrentRequests: Math.floor(maxConcurrentRequests),
          }),
        );
        return;
      }
      if (req.method === "GET" && req.url === "/readyz") {
        const readiness = await proxy.ready();
        res.statusCode = readiness.ok ? 200 : 503;
        applyCorsHeaders(res, options.cors);
        applyRequestIdHeader(res, requestId);
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            status: readiness.ok ? "ready" : "not_ready",
            agentId: readiness.agentId,
            ...(readiness.error ? { error: readiness.error } : {}),
          }),
        );
        return;
      }
      if (req.method === "POST" && req.url === "/reloadz") {
        if (!options.adminToken?.trim()) {
          res.statusCode = 404;
          applyCorsHeaders(res, options.cors);
          applyRequestIdHeader(res, requestId);
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              error: {
                message: "Not found.",
                type: "invalid_request_error",
              },
            }),
          );
          return;
        }
        const inboundAdminToken = resolveAdminToken(req);
        if (!inboundAdminToken || inboundAdminToken !== options.adminToken.trim()) {
          res.statusCode = 401;
          applyCorsHeaders(res, options.cors);
          applyRequestIdHeader(res, requestId);
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              error: {
                message: "Unauthorized reload request.",
                type: "authentication_error",
              },
            }),
          );
          return;
        }
        const body = await readRequestBody(req, Math.floor(maxRequestBytes));
        const agentId = parseReloadAgentId(body);
        const reloaded = await proxy.reload(agentId);
        res.statusCode = 200;
        applyCorsHeaders(res, options.cors);
        applyRequestIdHeader(res, requestId);
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            status: "ok",
            ...reloaded,
          }),
        );
        return;
      }
      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        applyCorsHeaders(res, options.cors);
        applyRequestIdHeader(res, requestId);
        res.end();
        return;
      }
      const body = await readRequestBody(req, Math.floor(maxRequestBytes));
      const requestInit: RequestInit = {
        method: req.method ?? "GET",
        headers: fetchHeaders,
      };
      if (body.length > 0) {
        requestInit.body = Buffer.from(body);
      }
      const request = new Request(requestUrl(req), requestInit);
      const response = await proxy.handle(request);
      applyCorsHeaders(res, options.cors);
      applyRequestIdHeader(res, requestId);
      await writeFetchResponse(response, res);
    } catch (error) {
      if (error instanceof Error && /Request body exceeds limit/.test(error.message)) {
        res.statusCode = 413;
        applyCorsHeaders(res, options.cors);
        applyRequestIdHeader(res, requestId);
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            error: {
              message: error.message,
              type: "invalid_request_error",
            },
          }),
        );
        return;
      }
      if (error instanceof Error && /reload endpoint|Reload body/.test(error.message)) {
        res.statusCode = 400;
        applyCorsHeaders(res, options.cors);
        applyRequestIdHeader(res, requestId);
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            error: {
              message: error.message,
              type: "invalid_request_error",
            },
          }),
        );
        return;
      }
      res.statusCode = 500;
      applyCorsHeaders(res, options.cors);
      applyRequestIdHeader(res, requestId);
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          error: {
            message: error instanceof Error ? error.message : "Proxy server failed.",
            type: "internal_error",
          },
        }),
      );
    } finally {
      activeRequests = Math.max(0, activeRequests - 1);
    }
  });

  return {
    server,
    listen: (port = 0, host = "127.0.0.1") =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          const address = server.address();
          if (!address || typeof address === "string") {
            reject(new Error("Unable to resolve listening address."));
            return;
          }
          resolve({
            port: address.port,
            host: address.address,
          });
        });
      }),
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}
