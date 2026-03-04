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

    const response = await proxy.handle(
      new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
          authorization: "Bearer client-key",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: "hello" }],
        }),
      }),
    );

    expect(response.status).toBe(200);
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
    expect(body.model).toBe("openai/gpt-4.1");
    expect(body.messages?.[0]?.role).toBe("system");
    expect(body.messages?.[0]?.content).toContain("You are a premium web designer.");
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
    const payload = (await response.json()) as {
      data?: Array<{ id?: string; root?: string }>;
    };
    const ids = (payload.data ?? []).map((entry) => entry.id);
    expect(ids).toContain("agent:designer");
    expect(ids).toContain("agent:seo");
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
  });
});
