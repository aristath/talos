import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createOpenAICompatibleProxyFromFile,
  createOpenAICompatibleProxyServerFromFile,
  startOpenAICompatibleProxyServerFromFile,
} from "./bootstrap.js";

async function setupWorkspace(): Promise<string> {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "soulSwitch-proxy-bootstrap-"));
  const agentDir = path.join(workspaceDir, "agents", "designer");
  await fs.mkdir(agentDir, { recursive: true });
  await fs.writeFile(path.join(agentDir, "SOUL.md"), "Designer soul", "utf8");
  await fs.writeFile(
    path.join(agentDir, "agent.json"),
    JSON.stringify(
      {
        upstream: {
          providerId: "openrouter",
          baseURL: "https://openrouter.ai/api/v1",
          auth: {
            type: "static",
            apiKey: "sk-designer",
          },
        },
        model: {
          default: "openai/gpt-4.1",
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  await fs.writeFile(
    path.join(workspaceDir, "proxy.json"),
    JSON.stringify(
      {
        defaultAgentId: "designer",
      },
      null,
      2,
    ),
    "utf8",
  );
  return workspaceDir;
}

describe("proxy bootstrap helpers", () => {
  it("creates proxy handle from proxy.json", async () => {
    const workspaceDir = await setupWorkspace();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "chatcmpl_1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const proxy = await createOpenAICompatibleProxyFromFile({ workspaceDir });
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
    vi.unstubAllGlobals();
  });

  it("creates HTTP server from proxy.json", async () => {
    const workspaceDir = await setupWorkspace();
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const target = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (target.startsWith("http://127.0.0.1:")) {
        return await originalFetch(input, init);
      }
      return new Response(JSON.stringify({ id: "chatcmpl_1" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const server = await createOpenAICompatibleProxyServerFromFile({ workspaceDir });
    const listening = await server.listen();
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
    } finally {
      await server.close();
      vi.unstubAllGlobals();
    }
  });

  it("fails fast when verifyReady is enabled and agent profile is invalid", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "soulSwitch-proxy-bootstrap-not-ready-"));
    await fs.writeFile(
      path.join(workspaceDir, "proxy.json"),
      JSON.stringify(
        {
          defaultAgentId: "designer",
        },
        null,
        2,
      ),
      "utf8",
    );

    await expect(
      createOpenAICompatibleProxyFromFile({
        workspaceDir,
        verifyReady: true,
      }),
    ).rejects.toMatchObject({ code: "CONFIG_INVALID" });

    await expect(
      createOpenAICompatibleProxyServerFromFile({
        workspaceDir,
        verifyReady: true,
      }),
    ).rejects.toMatchObject({ code: "CONFIG_INVALID" });
  });

  it("starts proxy server from file and returns bound address", async () => {
    const workspaceDir = await setupWorkspace();
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const target = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (target.startsWith("http://127.0.0.1:")) {
        return await originalFetch(input, init);
      }
      return new Response(JSON.stringify({ id: "chatcmpl_1" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const started = await startOpenAICompatibleProxyServerFromFile({
      workspaceDir,
      verifyReady: true,
    });
    try {
      expect(started.address.port).toBeGreaterThan(0);
      expect(started.url).toContain(`:${started.address.port}`);
      const response = await fetch(`http://${started.address.host}:${started.address.port}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: "hello" }],
        }),
      });
      expect(response.status).toBe(200);
    } finally {
      await started.server.close();
      vi.unstubAllGlobals();
    }
  });
});
