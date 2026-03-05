import { describe, expect, it } from "vitest";
import { createSoulSwitch } from "../soulSwitch.js";

describe("tools e2e", () => {
  it("runs a full tool loop across built-in tool families", async () => {
    const soulSwitch = createSoulSwitch({
      providers: {
        openaiCompatible: [],
      },
      models: {
        toolLoopMaxSteps: 2,
      },
    });

    soulSwitch.registerAgent({
      id: "main",
      model: {
        providerId: "mock",
        modelId: "m",
      },
    });

    const browserCalls: Array<{ action: string; args: Record<string, unknown> }> = [];
    const canvasCalls: Array<{ action: string; args: Record<string, unknown> }> = [];
    const mediaCalls: Array<{ input: string; prompt?: string; model?: string }> = [];
    const fetchCalls: string[] = [];
    const searchCalls: string[] = [];

    soulSwitch.registerWebTools({
      search: {
        defaultProvider: "duckduckgo",
        search: async ({ query, count }) => {
          searchCalls.push(query);
          return [
            {
              title: "SoulSwitch",
              url: "https://example.com/soulswitch",
              snippet: `query=${query} count=${count}`,
            },
          ];
        },
      },
      fetch: {
        fetchContent: async ({ url }) => {
          fetchCalls.push(url);
          return {
            content: "Fetched content",
            title: "Example",
            sourceUrl: url,
            finalUrl: url,
            statusCode: 200,
            contentType: "text/html",
          };
        },
      },
    });

    soulSwitch.registerMediaTools({
      image: {
        analyze: async (params) => {
          mediaCalls.push({
            input: params.input,
            ...(params.prompt ? { prompt: params.prompt } : {}),
            ...(params.model ? { model: params.model } : {}),
          });
          return {
            text: "Image analyzed",
            data: {
              kind: "image",
            },
          };
        },
      },
      pdf: {
        analyze: async (params) => {
          mediaCalls.push({
            input: params.input,
            ...(params.prompt ? { prompt: params.prompt } : {}),
            ...(params.model ? { model: params.model } : {}),
          });
          return {
            text: "PDF analyzed",
            data: {
              kind: "pdf",
            },
          };
        },
      },
    });

    soulSwitch.registerBrowserTools({
      execute: async ({ action, args }) => {
        browserCalls.push({ action, args });
        return {
          content: `browser:${action}`,
        };
      },
    });

    soulSwitch.registerCanvasTools({
      execute: async ({ action, args }) => {
        canvasCalls.push({ action, args });
        return {
          content: `canvas:${action}`,
        };
      },
    });

    soulSwitch.registerLlmTaskTool({
      defaultProviderId: "mock",
      defaultModelId: "m",
    });

    soulSwitch.registerModelProvider({
      id: "mock",
      async generate(request) {
        if ((request.system ?? "").includes("JSON-only function")) {
          return {
            text: JSON.stringify({ ok: true, source: "llm_task" }),
            providerId: request.providerId,
            modelId: request.modelId,
          };
        }
        return {
          text: JSON.stringify({
            toolCalls: [
              { name: "web_search", args: { query: "SoulSwitch", provider: "duckduckgo", count: 1 } },
              { name: "web_fetch", args: { url: "https://example.com" } },
              { name: "image", args: { image: "https://example.com/image.png", prompt: "describe" } },
              { name: "pdf", args: { document: "https://example.com/doc.pdf", prompt: "summarize" } },
              { name: "browser", args: { action: "status" } },
              { name: "canvas", args: { action: "present", target: "https://example.com" } },
              { name: "llm_task", args: { prompt: "Return JSON" } },
            ],
            final: "all-tools-ok",
          }),
          providerId: request.providerId,
          modelId: request.modelId,
        };
      },
    });

    const result = await soulSwitch.run({
      agentId: "main",
      prompt: "Run all tools",
    });

    expect(result.text).toBe("all-tools-ok");
    expect(searchCalls).toContain("SoulSwitch");
    expect(fetchCalls.some((url) => url.startsWith("https://example.com"))).toBe(true);
    expect(browserCalls.some((entry) => entry.action === "status")).toBe(true);
    expect(canvasCalls.some((entry) => entry.action === "present")).toBe(true);
    expect(mediaCalls.some((entry) => entry.input.endsWith("image.png"))).toBe(true);
    expect(mediaCalls.some((entry) => entry.input.endsWith("doc.pdf"))).toBe(true);

    const toolEvents = soulSwitch
      .queryEvents({ type: "tool.completed" })
      .filter((event) => (event.data as { runId?: string }).runId === result.runId);
    const invoked = new Set(toolEvents.map((event) => (event.data as { name?: string }).name));
    expect(invoked.has("web_search")).toBe(true);
    expect(invoked.has("web_fetch")).toBe(true);
    expect(invoked.has("image")).toBe(true);
    expect(invoked.has("pdf")).toBe(true);
    expect(invoked.has("browser")).toBe(true);
    expect(invoked.has("canvas")).toBe(true);
    expect(invoked.has("llm_task")).toBe(true);
  });

  it("runs session tools end-to-end", async () => {
    const soulSwitch = createSoulSwitch({
      providers: {
        openaiCompatible: [],
      },
    });

    soulSwitch.registerAgent({
      id: "main",
      model: {
        providerId: "mock",
        modelId: "m",
      },
    });

    soulSwitch.registerModelProvider({
      id: "mock",
      async generate(request) {
        return {
          text: `echo:${request.prompt}`,
          providerId: request.providerId,
          modelId: request.modelId,
        };
      },
    });

    soulSwitch.registerSessionTools();

    await soulSwitch.run({
      agentId: "main",
      prompt: "hello",
      sessionId: "main",
    });

    const list = await soulSwitch.executeTool({
      name: "sessions_list",
      args: {},
      context: { agentId: "main", sessionId: "main" },
    });
    const listData = list.data as { count?: number };
    expect((listData.count ?? 0) > 0).toBe(true);

    const send = await soulSwitch.executeTool({
      name: "sessions_send",
      args: {
        sessionId: "main",
        message: "ping",
      },
      context: { agentId: "main", sessionId: "main" },
    });
    const sendData = send.data as { status?: string; reply?: string };
    expect(sendData.status).toBe("ok");
    expect((sendData.reply ?? "").startsWith("echo:")).toBe(true);

    const spawn = await soulSwitch.executeTool({
      name: "sessions_spawn",
      args: {
        task: "child task",
      },
      context: { agentId: "main", sessionId: "main" },
    });
    const spawnData = spawn.data as { sessionId?: string; runId?: string };
    expect(typeof spawnData.sessionId).toBe("string");
    expect(typeof spawnData.runId).toBe("string");

    const status = await soulSwitch.executeTool({
      name: "session_status",
      args: {
        sessionId: spawnData.sessionId,
      },
      context: { agentId: "main", sessionId: "main" },
    });
    const statusData = status.data as { status?: string; sessionId?: string };
    expect(statusData.status).toBe("ok");
    expect(statusData.sessionId).toBe(spawnData.sessionId);

    const history = await soulSwitch.executeTool({
      name: "sessions_history",
      args: {
        sessionId: "main",
        limit: 10,
      },
      context: { agentId: "main", sessionId: "main" },
    });
    const historyData = history.data as { count?: number; messages?: Array<{ text?: string }> };
    expect((historyData.count ?? 0) > 0).toBe(true);
    expect(Array.isArray(historyData.messages)).toBe(true);
  });
});
