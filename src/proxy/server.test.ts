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
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: "hello" }],
        }),
      });
      expect(response.status).toBe(200);
      const calls = fetchMock.mock.calls as unknown as Array<[unknown, unknown?]>;
      const upstreamCall = calls.find((entry) => String(entry[0]).startsWith("https://openrouter.ai"));
      expect(String(upstreamCall?.[0] ?? "")).toBe("https://openrouter.ai/api/v1/chat/completions");
    } finally {
      await proxyServer.close();
    }
  });
});
