import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenAICompatibleProxyServer } from "./server.js";

async function setupAgent(params: {
  workspaceDir: string;
  agentId: string;
  soul: string;
  apiKey: string;
  baseURL: string;
  model: string;
}): Promise<void> {
  const agentDir = path.join(params.workspaceDir, "agents", params.agentId);
  await fs.mkdir(agentDir, { recursive: true });
  await fs.writeFile(path.join(agentDir, "SOUL.md"), params.soul, "utf8");
  await fs.writeFile(
    path.join(agentDir, "agent.json"),
    JSON.stringify(
      {
        upstream: {
          providerId: "openrouter",
          baseURL: params.baseURL,
          auth: {
            type: "static",
            apiKey: params.apiKey,
          },
        },
        model: {
          default: params.model,
        },
      },
      null,
      2,
    ),
    "utf8",
  );
}

describe("createOpenAICompatibleProxyServer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("serves OpenAI-compatible endpoints over HTTP", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "talos-proxy-server-"));
    await setupAgent({
      workspaceDir,
      agentId: "designer",
      soul: "Designer soul",
      apiKey: "sk-designer",
      baseURL: "https://openrouter.ai/api/v1",
      model: "openai/gpt-4.1",
    });

    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const target = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (target.startsWith("http://127.0.0.1:")) {
        return await originalFetch(input, init);
      }
      return new Response(JSON.stringify({ id: "chatcmpl_1" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const proxyServer = createOpenAICompatibleProxyServer({
      workspaceDir,
      defaultAgentId: "designer",
    });
    const listening = await proxyServer.listen();

    try {
      const response = await fetch(`http://${listening.host}:${listening.port}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-request-id": "req-server-1",
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: "hello" }],
        }),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("x-request-id")).toBe("req-server-1");
      const calls = fetchMock.mock.calls as unknown as Array<[unknown, unknown?]>;
      const upstreamCall = calls.find((entry) => String(entry[0]).startsWith("https://openrouter.ai"));
      expect(String(upstreamCall?.[0] ?? "")).toBe("https://openrouter.ai/api/v1/chat/completions");
    } finally {
      await proxyServer.close();
    }
  });

  it("supports CORS preflight and response headers", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "talos-proxy-server-cors-"));
    await setupAgent({
      workspaceDir,
      agentId: "designer",
      soul: "Designer soul",
      apiKey: "sk-designer",
      baseURL: "https://openrouter.ai/api/v1",
      model: "openai/gpt-4.1",
    });

    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const target = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (target.startsWith("http://127.0.0.1:")) {
        return await originalFetch(input, init);
      }
      return new Response(JSON.stringify({ id: "chatcmpl_1" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const proxyServer = createOpenAICompatibleProxyServer({
      workspaceDir,
      defaultAgentId: "designer",
      cors: {
        allowOrigin: "*",
      },
    });
    const listening = await proxyServer.listen();

    try {
      const preflight = await fetch(`http://${listening.host}:${listening.port}/v1/chat/completions`, {
        method: "OPTIONS",
      });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
      expect(preflight.headers.get("x-request-id")).toBeTruthy();

      const response = await fetch(`http://${listening.host}:${listening.port}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: "hello" }],
        }),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect(response.headers.get("x-request-id")).toBeTruthy();
    } finally {
      await proxyServer.close();
    }
  });

  it("exposes health endpoint", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "talos-proxy-server-health-"));
    await setupAgent({
      workspaceDir,
      agentId: "designer",
      soul: "Designer soul",
      apiKey: "sk-designer",
      baseURL: "https://openrouter.ai/api/v1",
      model: "openai/gpt-4.1",
    });

    const proxyServer = createOpenAICompatibleProxyServer({
      workspaceDir,
      defaultAgentId: "designer",
    });
    const listening = await proxyServer.listen();
    try {
      const response = await fetch(`http://${listening.host}:${listening.port}/healthz`);
      expect(response.status).toBe(200);
      expect(response.headers.get("x-request-id")).toBeTruthy();
      const payload = (await response.json()) as {
        status?: string;
        uptimeMs?: number;
        activeRequests?: number;
        maxConcurrentRequests?: number;
      };
      expect(payload.status).toBe("ok");
      expect(typeof payload.uptimeMs).toBe("number");
      expect(typeof payload.activeRequests).toBe("number");
      expect(payload.maxConcurrentRequests).toBe(200);
    } finally {
      await proxyServer.close();
    }
  });

  it("exposes readiness endpoint", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "talos-proxy-server-ready-"));
    await setupAgent({
      workspaceDir,
      agentId: "designer",
      soul: "Designer soul",
      apiKey: "sk-designer",
      baseURL: "https://openrouter.ai/api/v1",
      model: "openai/gpt-4.1",
    });

    const proxyServer = createOpenAICompatibleProxyServer({
      workspaceDir,
      defaultAgentId: "designer",
    });
    const listening = await proxyServer.listen();
    try {
      const response = await fetch(`http://${listening.host}:${listening.port}/readyz`);
      expect(response.status).toBe(200);
      expect(response.headers.get("x-request-id")).toBeTruthy();
      const payload = (await response.json()) as { status?: string; agentId?: string };
      expect(payload.status).toBe("ready");
      expect(payload.agentId).toBe("designer");
    } finally {
      await proxyServer.close();
    }
  });

  it("returns 503 on readiness failures", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "talos-proxy-server-not-ready-"));
    const proxyServer = createOpenAICompatibleProxyServer({
      workspaceDir,
      defaultAgentId: "designer",
    });
    const listening = await proxyServer.listen();
    try {
      const response = await fetch(`http://${listening.host}:${listening.port}/readyz`);
      expect(response.status).toBe(503);
      const payload = (await response.json()) as { status?: string; error?: string };
      expect(payload.status).toBe("not_ready");
      expect(payload.error).toBeTruthy();
    } finally {
      await proxyServer.close();
    }
  });

  it("exposes server metrics endpoint", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "talos-proxy-server-metrics-"));
    await setupAgent({
      workspaceDir,
      agentId: "designer",
      soul: "Designer soul",
      apiKey: "sk-designer",
      baseURL: "https://openrouter.ai/api/v1",
      model: "openai/gpt-4.1",
    });

    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const target = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (target.startsWith("http://127.0.0.1:")) {
        return await originalFetch(input, init);
      }
      return new Response(JSON.stringify({ id: "chatcmpl_1" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const proxyServer = createOpenAICompatibleProxyServer({
      workspaceDir,
      defaultAgentId: "designer",
    });
    const listening = await proxyServer.listen();
    try {
      const runResponse = await fetch(`http://${listening.host}:${listening.port}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: "hello" }],
        }),
      });
      expect(runResponse.status).toBe(200);

      const metrics = await fetch(`http://${listening.host}:${listening.port}/metricsz`);
      expect(metrics.status).toBe(200);
      const payload = (await metrics.json()) as {
        status?: string;
        totalRequests?: number;
        totalResponses?: number;
        responses2xx?: number;
      };
      expect(payload.status).toBe("ok");
      expect((payload.totalRequests ?? 0)).toBeGreaterThanOrEqual(2);
      expect((payload.totalResponses ?? 0)).toBeGreaterThanOrEqual(1);
      expect((payload.responses2xx ?? 0)).toBeGreaterThanOrEqual(1);
    } finally {
      await proxyServer.close();
      vi.unstubAllGlobals();
    }
  });

  it("supports authenticated cache reload endpoint", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "talos-proxy-server-reload-"));
    await setupAgent({
      workspaceDir,
      agentId: "designer",
      soul: "Designer soul",
      apiKey: "sk-designer",
      baseURL: "https://openrouter.ai/api/v1",
      model: "openai/gpt-4.1",
    });

    const proxyServer = createOpenAICompatibleProxyServer({
      workspaceDir,
      defaultAgentId: "designer",
      adminToken: "admin-secret",
    });
    const listening = await proxyServer.listen();
    try {
      const unauthorized = await fetch(`http://${listening.host}:${listening.port}/reloadz`, {
        method: "POST",
      });
      expect(unauthorized.status).toBe(401);

      const authorized = await fetch(`http://${listening.host}:${listening.port}/reloadz`, {
        method: "POST",
        headers: {
          "x-admin-token": "admin-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          agentId: "designer",
        }),
      });
      expect(authorized.status).toBe(200);
      const payload = (await authorized.json()) as { status?: string; cleared?: number; agentId?: string };
      expect(payload.status).toBe("ok");
      expect(payload.cleared).toBeGreaterThanOrEqual(0);
      expect(payload.agentId).toBe("designer");
    } finally {
      await proxyServer.close();
    }
  });

  it("hides reload endpoint when admin token is not configured", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "talos-proxy-server-no-reload-"));
    await setupAgent({
      workspaceDir,
      agentId: "designer",
      soul: "Designer soul",
      apiKey: "sk-designer",
      baseURL: "https://openrouter.ai/api/v1",
      model: "openai/gpt-4.1",
    });

    const proxyServer = createOpenAICompatibleProxyServer({
      workspaceDir,
      defaultAgentId: "designer",
    });
    const listening = await proxyServer.listen();
    try {
      const response = await fetch(`http://${listening.host}:${listening.port}/reloadz`, {
        method: "POST",
      });
      expect(response.status).toBe(404);
    } finally {
      await proxyServer.close();
    }
  });

  it("returns 400 for invalid reload request payloads", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "talos-proxy-server-reload-invalid-"));
    await setupAgent({
      workspaceDir,
      agentId: "designer",
      soul: "Designer soul",
      apiKey: "sk-designer",
      baseURL: "https://openrouter.ai/api/v1",
      model: "openai/gpt-4.1",
    });

    const proxyServer = createOpenAICompatibleProxyServer({
      workspaceDir,
      defaultAgentId: "designer",
      adminToken: "admin-secret",
    });
    const listening = await proxyServer.listen();
    try {
      const invalidJson = await fetch(`http://${listening.host}:${listening.port}/reloadz`, {
        method: "POST",
        headers: {
          "x-admin-token": "admin-secret",
          "content-type": "application/json",
        },
        body: "{",
      });
      expect(invalidJson.status).toBe(400);

      const invalidShape = await fetch(`http://${listening.host}:${listening.port}/reloadz`, {
        method: "POST",
        headers: {
          "x-admin-token": "admin-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify(["designer"]),
      });
      expect(invalidShape.status).toBe(400);
    } finally {
      await proxyServer.close();
    }
  });

  it("returns 413 when request body exceeds configured maxRequestBytes", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "talos-proxy-server-limit-"));
    await setupAgent({
      workspaceDir,
      agentId: "designer",
      soul: "Designer soul",
      apiKey: "sk-designer",
      baseURL: "https://openrouter.ai/api/v1",
      model: "openai/gpt-4.1",
    });

    const proxyServer = createOpenAICompatibleProxyServer({
      workspaceDir,
      defaultAgentId: "designer",
      maxRequestBytes: 64,
    });
    const listening = await proxyServer.listen();
    try {
      const response = await fetch(`http://${listening.host}:${listening.port}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: "x".repeat(500) }],
        }),
      });
      expect(response.status).toBe(413);
      expect(response.headers.get("x-request-id")).toBeTruthy();
      const payload = (await response.json()) as { error?: { message?: string } };
      expect(payload.error?.message).toContain("exceeds limit");
    } finally {
      await proxyServer.close();
    }
  });

  it("throws when maxRequestBytes is invalid", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "talos-proxy-server-invalid-limit-"));
    await setupAgent({
      workspaceDir,
      agentId: "designer",
      soul: "Designer soul",
      apiKey: "sk-designer",
      baseURL: "https://openrouter.ai/api/v1",
      model: "openai/gpt-4.1",
    });

    expect(() =>
      createOpenAICompatibleProxyServer({
        workspaceDir,
        defaultAgentId: "designer",
        maxRequestBytes: 0,
      }),
    ).toThrow(/maxRequestBytes/i);
  });

  it("returns 429 when max concurrent requests is exceeded", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "talos-proxy-server-concurrency-"));
    await setupAgent({
      workspaceDir,
      agentId: "designer",
      soul: "Designer soul",
      apiKey: "sk-designer",
      baseURL: "https://openrouter.ai/api/v1",
      model: "openai/gpt-4.1",
    });

    const originalFetch = globalThis.fetch;
    let releaseFirst: (() => void) | undefined;
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const target = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (target.startsWith("http://127.0.0.1:")) {
        return await originalFetch(input, init);
      }
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      return new Response(JSON.stringify({ id: "chatcmpl_slow" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const proxyServer = createOpenAICompatibleProxyServer({
      workspaceDir,
      defaultAgentId: "designer",
      maxConcurrentRequests: 1,
    });
    const listening = await proxyServer.listen();
    try {
      const firstPromise = fetch(`http://${listening.host}:${listening.port}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: "hello" }],
        }),
      });

      const waitStart = Date.now();
      while (!releaseFirst && Date.now() - waitStart < 1000) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(releaseFirst).toBeTruthy();

      const secondResponse = await fetch(`http://${listening.host}:${listening.port}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: "second" }],
        }),
      });
      expect(secondResponse.status).toBe(429);
      expect(secondResponse.headers.get("x-request-id")).toBeTruthy();

      releaseFirst?.();
      const firstResponse = await firstPromise;
      expect(firstResponse.status).toBe(200);
    } finally {
      releaseFirst?.();
      await proxyServer.close();
    }
  });

  it("throws when maxConcurrentRequests is invalid", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "talos-proxy-server-invalid-concurrency-"));
    await setupAgent({
      workspaceDir,
      agentId: "designer",
      soul: "Designer soul",
      apiKey: "sk-designer",
      baseURL: "https://openrouter.ai/api/v1",
      model: "openai/gpt-4.1",
    });

    expect(() =>
      createOpenAICompatibleProxyServer({
        workspaceDir,
        defaultAgentId: "designer",
        maxConcurrentRequests: 0,
      }),
    ).toThrow(/maxConcurrentRequests/i);
  });
});
