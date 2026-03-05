import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenAICompatibleProxy } from "./openai-compatible-proxy.js";

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
          headers: {
            "x-agent": params.agentId,
          },
        },
        model: {
          default: params.model,
          fallbacks: ["fallback-model"],
        },
      },
      null,
      2,
    ),
    "utf8",
  );
}

describe("createOpenAICompatibleProxy", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("injects persona into chat completions and forwards upstream", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "talos-proxy-chat-"));
    await setupAgent({
      workspaceDir,
      agentId: "designer",
      soul: "You are a premium web designer.",
      apiKey: "sk-designer",
      baseURL: "https://openrouter.ai/api/v1",
      model: "openai/gpt-4.1",
    });

    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ id: "chatcmpl_1" }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const proxy = createOpenAICompatibleProxy({
      workspaceDir,
      defaultAgentId: "designer",
      inboundAuth: {
        "client-key": {
          defaultAgentId: "designer",
        },
      },
    });

    const ready = await proxy.ready();
    expect(ready.ok).toBe(true);
    expect(ready.agentId).toBe("designer");

    const response = await proxy.handle(
      new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
          authorization: "Bearer client-key",
          "content-type": "application/json",
          "x-request-id": "req-123",
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: "hello" }],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("req-123");
    expect(response.headers.get("x-talos-agent-id")).toBe("designer");
    expect(response.headers.get("x-talos-model")).toBe("openai/gpt-4.1");
    const calls = fetchMock.mock.calls as unknown as Array<[unknown, unknown?]>;
    expect(String(calls[0]?.[0])).toBe("https://openrouter.ai/api/v1/chat/completions");
    const init = (calls[0]?.[1] ?? {}) as {
      headers?: Record<string, string>;
      body?: string;
    };
    const body = JSON.parse(init.body ?? "{}") as {
      model?: string;
      messages?: Array<{ role?: string; content?: string }>;
    };
    expect(init.headers?.authorization).toBe("Bearer sk-designer");
    expect(init.headers?.["x-agent"]).toBe("designer");
    expect(init.headers?.["x-request-id"]).toBe("req-123");
    expect(body.model).toBe("openai/gpt-4.1");
    expect(body.messages?.[0]?.role).toBe("system");
    expect(body.messages?.[0]?.content).toContain("You are a premium web designer.");
  });

  it("reports not_ready when default agent profile cannot be resolved", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "talos-proxy-not-ready-"));
    const proxy = createOpenAICompatibleProxy({
      workspaceDir,
      defaultAgentId: "missing",
    });

    const ready = await proxy.ready();
    expect(ready.ok).toBe(false);
    expect(ready.agentId).toBe("missing");
    expect(ready.error).toBeTruthy();
  });

  it("reloads cached agent persona profiles on demand", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "talos-proxy-reload-"));
    await setupAgent({
      workspaceDir,
      agentId: "designer",
      soul: "Original soul",
      apiKey: "sk-designer",
      baseURL: "https://openrouter.ai/api/v1",
      model: "openai/gpt-4.1",
    });

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "chatcmpl_1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const proxy = createOpenAICompatibleProxy({
      workspaceDir,
      defaultAgentId: "designer",
      cacheTtlMs: 60_000,
    });

    await proxy.handle(
      new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: "hello" }],
        }),
      }),
    );

    const callsBefore = fetchMock.mock.calls as unknown as Array<[unknown, unknown?]>;
    const bodyBefore = JSON.parse(((callsBefore[0]?.[1] as { body?: string } | undefined)?.body ?? "{}")) as {
      messages?: Array<{ content?: string }>;
    };
    expect(bodyBefore.messages?.[0]?.content).toContain("Original soul");

    await fs.writeFile(path.join(workspaceDir, "agents", "designer", "SOUL.md"), "Updated soul", "utf8");
    await proxy.reload("designer");

    await proxy.handle(
      new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: "hello again" }],
        }),
      }),
    );

    const callsAfter = fetchMock.mock.calls as unknown as Array<[unknown, unknown?]>;
    const bodyAfter = JSON.parse(((callsAfter[1]?.[1] as { body?: string } | undefined)?.body ?? "{}")) as {
      messages?: Array<{ content?: string }>;
    };
    expect(bodyAfter.messages?.[0]?.content).toContain("Updated soul");
  });

  it("injects persona as instructions for responses endpoint", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "talos-proxy-responses-"));
    await setupAgent({
      workspaceDir,
      agentId: "designer",
      soul: "You are a premium web designer.",
      apiKey: "sk-designer",
      baseURL: "https://openrouter.ai/api/v1",
      model: "openai/gpt-4.1",
    });

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "resp_1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const proxy = createOpenAICompatibleProxy({
      workspaceDir,
      defaultAgentId: "designer",
    });

    await proxy.handle(
      new Request("http://localhost/v1/responses", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          input: "Draft homepage copy",
          instructions: "Keep it concise.",
        }),
      }),
    );

    const calls = fetchMock.mock.calls as unknown as Array<[unknown, unknown?]>;
    expect(String(calls[0]?.[0])).toBe("https://openrouter.ai/api/v1/responses");
    const init = (calls[0]?.[1] ?? {}) as { body?: string };
    const body = JSON.parse(init.body ?? "{}") as { instructions?: string; model?: string };
    expect(body.instructions).toContain("You are a premium web designer.");
    expect(body.instructions).toContain("Keep it concise.");
    expect(body.model).toBe("openai/gpt-4.1");
  });

  it("supports legacy completions endpoint with persona-prefixed prompt", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "talos-proxy-completions-"));
    await setupAgent({
      workspaceDir,
      agentId: "designer",
      soul: "You are a premium web designer.",
      apiKey: "sk-designer",
      baseURL: "https://openrouter.ai/api/v1",
      model: "openai/gpt-4.1",
    });

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "cmpl_1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const proxy = createOpenAICompatibleProxy({
      workspaceDir,
      defaultAgentId: "designer",
    });

    const response = await proxy.handle(
      new Request("http://localhost/v1/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          prompt: "Write a hero headline",
        }),
      }),
    );

    expect(response.status).toBe(200);
    const calls = fetchMock.mock.calls as unknown as Array<[unknown, unknown?]>;
    expect(String(calls[0]?.[0])).toBe("https://openrouter.ai/api/v1/completions");
    const init = (calls[0]?.[1] ?? {}) as { body?: string };
    const body = JSON.parse(init.body ?? "{}") as { prompt?: string; model?: string };
    expect(body.prompt).toContain("You are a premium web designer.");
    expect(body.prompt).toContain("Write a hero headline");
    expect(body.model).toBe("openai/gpt-4.1");
  });

  it("supports embeddings endpoint with model defaults", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "talos-proxy-embeddings-"));
    await setupAgent({
      workspaceDir,
      agentId: "designer",
      soul: "You are a premium web designer.",
      apiKey: "sk-designer",
      baseURL: "https://openrouter.ai/api/v1",
      model: "text-embedding-3-large",
    });

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ object: "list", data: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const proxy = createOpenAICompatibleProxy({
      workspaceDir,
      defaultAgentId: "designer",
    });

    const response = await proxy.handle(
      new Request("http://localhost/v1/embeddings", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          input: "homepage hero",
        }),
      }),
    );

    expect(response.status).toBe(200);
    const calls = fetchMock.mock.calls as unknown as Array<[unknown, unknown?]>;
    expect(String(calls[0]?.[0])).toBe("https://openrouter.ai/api/v1/embeddings");
    const init = (calls[0]?.[1] ?? {}) as { body?: string };
    const body = JSON.parse(init.body ?? "{}") as { model?: string; input?: string };
    expect(body.model).toBe("text-embedding-3-large");
    expect(body.input).toBe("homepage hero");
  });

  it("returns available agent models via /v1/models", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "talos-proxy-models-"));
    await setupAgent({
      workspaceDir,
      agentId: "designer",
      soul: "Designer soul",
      apiKey: "sk-designer",
      baseURL: "https://openrouter.ai/api/v1",
      model: "openai/gpt-4.1",
    });
    await setupAgent({
      workspaceDir,
      agentId: "seo",
      soul: "SEO soul",
      apiKey: "sk-seo",
      baseURL: "https://openrouter.ai/api/v1",
      model: "openai/gpt-4.1-mini",
    });

    const proxy = createOpenAICompatibleProxy({
      workspaceDir,
      defaultAgentId: "designer",
    });

    const response = await proxy.handle(new Request("http://localhost/v1/models", { method: "GET" }));
    expect(response.headers.get("x-request-id")).toBeTruthy();
    const payload = (await response.json()) as {
      data?: Array<{ id?: string; root?: string }>;
    };
    const ids = (payload.data ?? []).map((entry) => entry.id);
    expect(ids).toContain("agent:designer");
    expect(ids).toContain("agent:seo");

    const single = await proxy.handle(new Request("http://localhost/v1/models/agent:designer", { method: "GET" }));
    expect(single.status).toBe(200);
    expect(single.headers.get("x-request-id")).toBeTruthy();
    const singlePayload = (await single.json()) as { id?: string };
    expect(singlePayload.id).toBe("agent:designer");
  });

  it("protects and filters /v1/models when inbound auth is configured", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "talos-proxy-models-auth-"));
    await setupAgent({
      workspaceDir,
      agentId: "designer",
      soul: "Designer soul",
      apiKey: "sk-designer",
      baseURL: "https://openrouter.ai/api/v1",
      model: "openai/gpt-4.1",
    });
    await setupAgent({
      workspaceDir,
      agentId: "seo",
      soul: "SEO soul",
      apiKey: "sk-seo",
      baseURL: "https://openrouter.ai/api/v1",
      model: "openai/gpt-4.1-mini",
    });

    const proxy = createOpenAICompatibleProxy({
      workspaceDir,
      defaultAgentId: "designer",
      inboundAuth: {
        "client-key": {
          defaultAgentId: "designer",
          allowedAgentIds: ["designer"],
        },
      },
    });

    const unauthorized = await proxy.handle(new Request("http://localhost/v1/models", { method: "GET" }));
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("x-request-id")).toBeTruthy();

    const authorized = await proxy.handle(
      new Request("http://localhost/v1/models", {
        method: "GET",
        headers: {
          authorization: "Bearer client-key",
        },
      }),
    );
    expect(authorized.status).toBe(200);
    const payload = (await authorized.json()) as {
      data?: Array<{ id?: string }>;
    };
    const ids = (payload.data ?? []).map((entry) => entry.id);
    expect(ids).toEqual(["agent:designer"]);

    const deniedSingle = await proxy.handle(
      new Request("http://localhost/v1/models/agent:seo", {
        method: "GET",
        headers: {
          authorization: "Bearer client-key",
        },
      }),
    );
    expect(deniedSingle.status).toBe(404);
  });

  it("selects agent by model alias and enforces inbound auth allowlist", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "talos-proxy-alias-"));
    await setupAgent({
      workspaceDir,
      agentId: "designer",
      soul: "Designer soul",
      apiKey: "sk-designer",
      baseURL: "https://openrouter.ai/api/v1",
      model: "openai/gpt-4.1",
    });
    await setupAgent({
      workspaceDir,
      agentId: "seo",
      soul: "SEO soul",
      apiKey: "sk-seo",
      baseURL: "https://openrouter.ai/api/v1",
      model: "openai/gpt-4.1-mini",
    });

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "chatcmpl_alias" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const proxy = createOpenAICompatibleProxy({
      workspaceDir,
      defaultAgentId: "designer",
      inboundAuth: {
        "client-key": {
          defaultAgentId: "designer",
          allowedAgentIds: ["designer"],
        },
      },
    });

    const denied = await proxy.handle(
      new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
          authorization: "Bearer client-key",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "agent:seo",
          messages: [{ role: "user", content: "hi" }],
        }),
      }),
    );
    expect(denied.status).toBe(403);

    const allowed = await proxy.handle(
      new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
          authorization: "Bearer client-key",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "agent:designer",
          messages: [{ role: "user", content: "hi" }],
        }),
      }),
    );

    expect(allowed.status).toBe(200);
    const calls = fetchMock.mock.calls as unknown as Array<[unknown, unknown?]>;
    const init = (calls.at(-1)?.[1] ?? {}) as { body?: string };
    const body = JSON.parse(init.body ?? "{}") as { model?: string };
    expect(body.model).toBe("openai/gpt-4.1");

    const conflict = await proxy.handle(
      new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
          authorization: "Bearer client-key",
          "content-type": "application/json",
          "x-agent-id": "designer",
        },
        body: JSON.stringify({
          model: "agent:seo",
          messages: [{ role: "user", content: "hi" }],
        }),
      }),
    );
    expect(conflict.status).toBe(400);
    expect(conflict.headers.get("x-request-id")).toBeTruthy();
  });

  it("passes through upstream streaming responses", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "talos-proxy-stream-"));
    await setupAgent({
      workspaceDir,
      agentId: "designer",
      soul: "Designer soul",
      apiKey: "sk-designer",
      baseURL: "https://openrouter.ai/api/v1",
      model: "openai/gpt-4.1",
    });

    const fetchMock = vi.fn(async () => {
      return new Response("data: {\"id\":\"chunk_1\"}\n\n", {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const proxy = createOpenAICompatibleProxy({
      workspaceDir,
      defaultAgentId: "designer",
    });

    const response = await proxy.handle(
      new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          stream: true,
          messages: [{ role: "user", content: "hello" }],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const payload = await response.text();
    expect(payload).toContain("chunk_1");
  });

  it("validates required payload fields per endpoint", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "talos-proxy-validate-"));
    await setupAgent({
      workspaceDir,
      agentId: "designer",
      soul: "Designer soul",
      apiKey: "sk-designer",
      baseURL: "https://openrouter.ai/api/v1",
      model: "openai/gpt-4.1",
    });

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "unused" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const proxy = createOpenAICompatibleProxy({
      workspaceDir,
      defaultAgentId: "designer",
    });

    const badChat = await proxy.handle(
      new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(badChat.status).toBe(400);

    const badResponses = await proxy.handle(
      new Request("http://localhost/v1/responses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "openai/gpt-4.1" }),
      }),
    );
    expect(badResponses.status).toBe(400);

    const badCompletions = await proxy.handle(
      new Request("http://localhost/v1/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: [] }),
      }),
    );
    expect(badCompletions.status).toBe(400);

    const badEmbeddings = await proxy.handle(
      new Request("http://localhost/v1/embeddings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "text-embedding-3-large" }),
      }),
    );
    expect(badEmbeddings.status).toBe(400);

    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it("attaches request id headers to inbound auth failures", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "talos-proxy-auth-headers-"));
    await setupAgent({
      workspaceDir,
      agentId: "designer",
      soul: "Designer soul",
      apiKey: "sk-designer",
      baseURL: "https://openrouter.ai/api/v1",
      model: "openai/gpt-4.1",
    });

    const proxy = createOpenAICompatibleProxy({
      workspaceDir,
      defaultAgentId: "designer",
      inboundAuth: {
        "client-key": {
          defaultAgentId: "designer",
        },
      },
    });

    const missingBearer = await proxy.handle(
      new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-request-id": "req-missing",
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: "hello" }],
        }),
      }),
    );
    expect(missingBearer.status).toBe(401);
    expect(missingBearer.headers.get("x-request-id")).toBe("req-missing");

    const invalidBearer = await proxy.handle(
      new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
          authorization: "Bearer wrong-key",
          "content-type": "application/json",
          "x-request-id": "req-invalid",
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: "hello" }],
        }),
      }),
    );
    expect(invalidBearer.status).toBe(403);
    expect(invalidBearer.headers.get("x-request-id")).toBe("req-invalid");
  });

  it("accepts inbound auth tokens from x-api-key header", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "talos-proxy-x-api-key-"));
    await setupAgent({
      workspaceDir,
      agentId: "designer",
      soul: "Designer soul",
      apiKey: "sk-designer",
      baseURL: "https://openrouter.ai/api/v1",
      model: "openai/gpt-4.1",
    });

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "chatcmpl_1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const proxy = createOpenAICompatibleProxy({
      workspaceDir,
      defaultAgentId: "designer",
      inboundAuth: {
        "client-key": {
          defaultAgentId: "designer",
          allowedAgentIds: ["designer"],
        },
      },
    });

    const response = await proxy.handle(
      new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": "client-key",
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: "hello" }],
        }),
      }),
    );
    expect(response.status).toBe(200);

    const modelsResponse = await proxy.handle(
      new Request("http://localhost/v1/models", {
        method: "GET",
        headers: {
          "x-api-key": "client-key",
        },
      }),
    );
    expect(modelsResponse.status).toBe(200);
  });

  it("rejects non-json content types", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "talos-proxy-content-type-"));
    await setupAgent({
      workspaceDir,
      agentId: "designer",
      soul: "Designer soul",
      apiKey: "sk-designer",
      baseURL: "https://openrouter.ai/api/v1",
      model: "openai/gpt-4.1",
    });

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "unused" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const proxy = createOpenAICompatibleProxy({
      workspaceDir,
      defaultAgentId: "designer",
    });

    const response = await proxy.handle(
      new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "text/plain",
          "x-request-id": "req-content-type",
        },
        body: "{}",
      }),
    );
    expect(response.status).toBe(415);
    expect(response.headers.get("x-request-id")).toBe("req-content-type");
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it("retries with fallback model when upstream returns 5xx", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "talos-proxy-fallback-"));
    await setupAgent({
      workspaceDir,
      agentId: "designer",
      soul: "Designer soul",
      apiKey: "sk-designer",
      baseURL: "https://openrouter.ai/api/v1",
      model: "primary-model",
    });

    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => new Response(JSON.stringify({ error: "temporary" }), { status: 503 }))
      .mockImplementationOnce(async () => new Response(JSON.stringify({ id: "chatcmpl_fallback" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const proxy = createOpenAICompatibleProxy({
      workspaceDir,
      defaultAgentId: "designer",
    });

    const response = await proxy.handle(
      new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: "hello" }],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-talos-model-fallback")).toBe("true");
    expect(response.headers.get("x-talos-model")).toBe("fallback-model");
    const calls = fetchMock.mock.calls as unknown as Array<[unknown, unknown?]>;
    const firstBody = JSON.parse(((calls[0]?.[1] as { body?: string } | undefined)?.body ?? "{}")) as {
      model?: string;
    };
    const secondBody = JSON.parse(((calls[1]?.[1] as { body?: string } | undefined)?.body ?? "{}")) as {
      model?: string;
    };
    expect(firstBody.model).toBe("primary-model");
    expect(secondBody.model).toBe("fallback-model");
  });
});
