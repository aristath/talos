import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createTalos } from "./talos.js";

describe("createTalos", () => {
  it("creates an engine with registration APIs", () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [
          {
            id: "openai",
            baseUrl: "https://api.openai.com/v1",
            defaultModel: "gpt-4o-mini",
          },
        ],
      },
    });

    expect(typeof talos.registerAgent).toBe("function");
    expect(typeof talos.listAgents).toBe("function");
    expect(typeof talos.hasAgent).toBe("function");
    expect(typeof talos.removeAgent).toBe("function");
    expect(typeof talos.registerTool).toBe("function");
    expect(typeof talos.registerExecTool).toBe("function");
    expect(typeof talos.registerWebTools).toBe("function");
    expect(typeof talos.registerMediaTools).toBe("function");
    expect(typeof talos.registerBrowserTools).toBe("function");
    expect(typeof talos.registerCanvasTools).toBe("function");
    expect(typeof talos.registerSessionTools).toBe("function");
    expect(typeof talos.registerLlmTaskTool).toBe("function");
    expect(typeof talos.listTools).toBe("function");
    expect(typeof talos.hasTool).toBe("function");
    expect(typeof talos.removeTool).toBe("function");
    expect(typeof talos.registerPlugin).toBe("function");
    expect(typeof talos.removePlugin).toBe("function");
    expect(typeof talos.listPlugins).toBe("function");
    expect(typeof talos.listPluginSummaries).toBe("function");
    expect(typeof talos.getPluginSummary).toBe("function");
    expect(typeof talos.hasPlugin).toBe("function");
    expect(typeof talos.listModelProviders).toBe("function");
    expect(typeof talos.hasModelProvider).toBe("function");
    expect(typeof talos.removeModelProvider).toBe("function");
    expect(typeof talos.registerAuthProfile).toBe("function");
    expect(typeof talos.listAuthProfiles).toBe("function");
    expect(typeof talos.hasAuthProfile).toBe("function");
    expect(typeof talos.removeAuthProfile).toBe("function");
    expect(typeof talos.onEvent).toBe("function");
    expect(typeof talos.seedPersonaWorkspace).toBe("function");
    expect(typeof talos.listRuns).toBe("function");
    expect(typeof talos.queryRuns).toBe("function");
    expect(typeof talos.getRun).toBe("function");
    expect(typeof talos.getRunStats).toBe("function");
    expect(typeof talos.getDiagnostics).toBe("function");
    expect(typeof talos.resetDiagnostics).toBe("function");
    expect(typeof talos.queryEvents).toBe("function");
    expect(typeof talos.run).toBe("function");
  });

  it("manages agent lifecycle in registry", () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [
          {
            id: "openai",
            baseUrl: "https://api.openai.com/v1",
            defaultModel: "gpt-4o-mini",
          },
        ],
      },
    });

    talos.registerAgent({ id: "main", name: "Main" });
    expect(talos.hasAgent("main")).toBe(true);
    expect(talos.listAgents().map((agent) => agent.id)).toContain("main");
    expect(talos.removeAgent("main")).toBe(true);
    expect(talos.hasAgent("main")).toBe(false);
  });

  it("manages tool lifecycle in registry", async () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [
          {
            id: "openai",
            baseUrl: "https://api.openai.com/v1",
            defaultModel: "gpt-4o-mini",
          },
        ],
      },
    });

    talos.registerTool({
      name: "echo",
      description: "echo",
      async run(args) {
        return { content: String(args.value ?? "") };
      },
    });

    expect(talos.hasTool("echo")).toBe(true);
    expect(talos.listTools().map((tool) => tool.name)).toContain("echo");
    expect(talos.removeTool("echo")).toBe(true);
    expect(talos.hasTool("echo")).toBe(false);
  });

  it("registers built-in exec tool using config defaults", async () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [
          {
            id: "openai",
            baseUrl: "https://api.openai.com/v1",
            defaultModel: "gpt-4o-mini",
          },
        ],
      },
      tools: {
        executionMode: "sandbox",
        sandbox: {
          allowedCommands: [process.execPath],
          allowedPaths: [process.cwd()],
        },
      },
    });

    talos.registerExecTool();
    expect(talos.hasTool("exec")).toBe(true);

    const result = await talos.executeTool({
      name: "exec",
      args: {
        command: process.execPath,
        args: ["-e", "console.log('exec-ok')"],
        cwd: process.cwd(),
      },
      context: { agentId: "main" },
    });
    expect(result.content).toContain("exec-ok");
  });

  it("registers web tools and executes web_search", async () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [
          {
            id: "openai",
            baseUrl: "https://api.openai.com/v1",
            defaultModel: "gpt-4o-mini",
          },
        ],
      },
    });

    talos.registerWebTools({
      search: {
        search: async ({ query }) => [
          {
            title: `Result for ${query}`,
            url: "https://example.com",
            snippet: "snippet",
          },
        ],
      },
      fetch: {
        fetchContent: async ({ url }) => ({
          title: "Example",
          content: `Fetched ${url}`,
        }),
      },
    });

    const search = await talos.executeTool({
      name: "web_search",
      args: {
        query: "talos",
      },
      context: { agentId: "main" },
    });
    const fetched = await talos.executeTool({
      name: "web_fetch",
      args: {
        url: "https://example.com",
      },
      context: { agentId: "main" },
    });

    expect(search.content).toContain("Result for talos");
    expect(fetched.content).toContain("Fetched https://example.com");
  });

  it("registers media tools and executes image/pdf analysis", async () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [
          {
            id: "openai",
            baseUrl: "https://api.openai.com/v1",
            defaultModel: "gpt-4o-mini",
          },
        ],
      },
    });

    talos.registerMediaTools({
      image: {
        analyze: async ({ input }) => ({ text: `image:${input}` }),
      },
      pdf: {
        analyze: async ({ input }) => ({ text: `pdf:${input}` }),
      },
    });

    const image = await talos.executeTool({
      name: "image",
      args: {
        image: "/tmp/a.png",
      },
      context: { agentId: "main" },
    });
    const pdf = await talos.executeTool({
      name: "pdf",
      args: {
        document: "/tmp/a.pdf",
      },
      context: { agentId: "main" },
    });

    expect(image.content).toBe("image:/tmp/a.png");
    expect(pdf.content).toBe("pdf:/tmp/a.pdf");
  });

  it("registers browser and canvas tools and routes actions", async () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [
          {
            id: "openai",
            baseUrl: "https://api.openai.com/v1",
            defaultModel: "gpt-4o-mini",
          },
        ],
      },
    });

    talos.registerBrowserTools({
      execute: async ({ action }) => ({
        content: `browser:${action}`,
      }),
    });
    talos.registerCanvasTools({
      execute: async ({ action }) => ({
        content: `canvas:${action}`,
      }),
    });

    const browser = await talos.executeTool({
      name: "browser",
      args: { action: "snapshot" },
      context: { agentId: "main" },
    });
    const canvas = await talos.executeTool({
      name: "canvas",
      args: { action: "present" },
      context: { agentId: "main" },
    });

    expect(browser.content).toBe("browser:snapshot");
    expect(canvas.content).toBe("canvas:present");
  });

  it("registers llm_task tool and parses JSON output", async () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [
          {
            id: "openai",
            baseUrl: "https://api.openai.com/v1",
            defaultModel: "gpt-4o-mini",
          },
        ],
      },
    });
    talos.registerModelProvider({
      id: "openai",
      async generate(request) {
        return {
          text: JSON.stringify({ ok: true, prompt: request.prompt }),
          providerId: request.providerId,
          modelId: request.modelId,
        };
      },
    });
    talos.registerLlmTaskTool();

    const result = await talos.executeTool({
      name: "llm_task",
      args: {
        prompt: "Return JSON",
      },
      context: { agentId: "main" },
    });

    expect(result.content).toContain('"ok": true');
  });

  it("fails llm_task when model output is invalid JSON", async () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [
          {
            id: "openai",
            baseUrl: "https://api.openai.com/v1",
            defaultModel: "gpt-4o-mini",
          },
        ],
      },
    });
    talos.registerModelProvider({
      id: "openai",
      async generate(request) {
        return {
          text: `not-json:${request.prompt}`,
          providerId: request.providerId,
          modelId: request.modelId,
        };
      },
    });
    talos.registerLlmTaskTool();

    await expect(
      talos.executeTool({
        name: "llm_task",
        args: {
          prompt: "Return JSON",
        },
        context: { agentId: "main" },
      }),
    ).rejects.toMatchObject({ code: "TOOL_FAILED" });
  });

  it("fails llm_task when JSON validation fails", async () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [
          {
            id: "openai",
            baseUrl: "https://api.openai.com/v1",
            defaultModel: "gpt-4o-mini",
          },
        ],
      },
    });
    talos.registerModelProvider({
      id: "openai",
      async generate(request) {
        return {
          text: JSON.stringify({ mode: "unsafe", prompt: request.prompt }),
          providerId: request.providerId,
          modelId: request.modelId,
        };
      },
    });
    talos.registerLlmTaskTool({
      validateJson: (value) => ({
        ok: Boolean(
          value &&
            typeof value === "object" &&
            !Array.isArray(value) &&
            (value as { mode?: string }).mode === "safe",
        ),
      }),
    });

    await expect(
      talos.executeTool({
        name: "llm_task",
        args: {
          prompt: "Return JSON",
        },
        context: { agentId: "main" },
      }),
    ).rejects.toMatchObject({ code: "TOOL_FAILED" });
  });

  it("registers session tools and orchestrates sessions", async () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [
          {
            id: "openai",
            baseUrl: "https://api.openai.com/v1",
            defaultModel: "gpt-4o-mini",
          },
        ],
      },
    });

    talos.registerAgent({ id: "main", model: { providerId: "openai", modelId: "gpt-4o-mini" } });
    talos.registerModelProvider({
      id: "openai",
      async generate(request) {
        return {
          text: `echo:${request.prompt}`,
          providerId: request.providerId,
          modelId: request.modelId,
        };
      },
    });
    talos.registerSessionTools();

    await talos.run({
      agentId: "main",
      prompt: "hello",
      sessionId: "main",
    });

    const list = await talos.executeTool({
      name: "sessions_list",
      args: {},
      context: { agentId: "main", sessionId: "main" },
    });
    const send = await talos.executeTool({
      name: "sessions_send",
      args: {
        sessionId: "main",
        message: "ping",
      },
      context: { agentId: "main", sessionId: "main" },
    });
    const spawn = await talos.executeTool({
      name: "sessions_spawn",
      args: {
        task: "sub task",
      },
      context: { agentId: "main", sessionId: "main" },
    });
    const history = await talos.executeTool({
      name: "sessions_history",
      args: {
        sessionId: "main",
      },
      context: { agentId: "main", sessionId: "main" },
    });
    const status = await talos.executeTool({
      name: "session_status",
      args: {
        sessionId: "main",
      },
      context: { agentId: "main", sessionId: "main" },
    });

    expect(list.content).toContain("main");
    expect(send.content).toContain("echo:ping");
    expect(spawn.content).toContain("echo:sub task");
    expect(history.content).toContain("user: hello");
    expect(status.content).toContain("main [main]");
  });

  it("lists registered plugins", async () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [
          {
            id: "openai",
            baseUrl: "https://api.openai.com/v1",
            defaultModel: "gpt-4o-mini",
          },
        ],
      },
    });

    await talos.registerPlugin({
      id: "hooks-one",
      capabilities: ["hooks"],
      setup(api) {
        api.on("beforeRun", () => undefined);
        api.on("beforePersonaLoad", (snapshot) => snapshot);
      },
    });

    expect(talos.hasPlugin("hooks-one")).toBe(true);
    expect(talos.listPlugins()).toContain("hooks-one");
  });

  it("returns plugin summaries", async () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [
          {
            id: "openai",
            baseUrl: "https://api.openai.com/v1",
            defaultModel: "gpt-4o-mini",
          },
        ],
      },
    });

    await talos.registerPlugin({
      id: "summary-plugin",
      capabilities: ["tools", "providers", "hooks"],
      setup(api) {
        api.registerTool({
          name: "summary-tool",
          description: "tool",
          async run() {
            return { content: "ok" };
          },
        });
        api.registerModelProvider({
          id: "summary-provider",
          async generate(request) {
            return {
              text: "ok",
              providerId: request.providerId,
              modelId: request.modelId,
            };
          },
        });
        api.on("beforeRun", () => undefined);
        api.on("beforePersonaLoad", (snapshot) => snapshot);
      },
    });

    const summaries = talos.listPluginSummaries();
    const summary = talos.getPluginSummary("summary-plugin");

    expect(summaries.some((entry) => entry.id === "summary-plugin")).toBe(true);
    expect(summary?.toolCount).toBe(1);
    expect(summary?.providerCount).toBe(1);
    expect(summary?.apiVersion).toBe(1);
    expect(summary?.capabilities).toContain("hooks");
    expect(summary?.hooks).toContain("beforeRun");
    expect(summary?.hooks).toContain("beforePersonaLoad");
  });

  it("unregisters plugins and cleans plugin-owned resources", async () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [
          {
            id: "openai",
            baseUrl: "https://api.openai.com/v1",
            defaultModel: "gpt-4o-mini",
          },
        ],
      },
    });

    await talos.registerPlugin({
      id: "plugin-resources",
      capabilities: ["tools", "providers", "hooks"],
      setup(api) {
        api.registerTool({
          name: "plugin-tool",
          description: "plugin tool",
          async run() {
            return { content: "ok" };
          },
        });
        api.registerModelProvider({
          id: "plugin-provider",
          async generate(request) {
            return {
              text: "ok",
              providerId: request.providerId,
              modelId: request.modelId,
            };
          },
        });
        api.on("beforeRun", () => undefined);
      },
    });

    expect(talos.hasPlugin("plugin-resources")).toBe(true);
    expect(talos.hasTool("plugin-tool")).toBe(true);
    expect(talos.hasModelProvider("plugin-provider")).toBe(true);

    const removed = await talos.removePlugin("plugin-resources");
    expect(removed).toBe(true);
    expect(talos.hasPlugin("plugin-resources")).toBe(false);
    expect(talos.hasTool("plugin-tool")).toBe(false);
    expect(talos.hasModelProvider("plugin-provider")).toBe(false);
  });

  it("stops plugin hooks after plugin unload and emits unregistered event", async () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [],
      },
    });

    talos.registerAgent({
      id: "main",
      model: { providerId: "provider", modelId: "model" },
    });
    talos.registerModelProvider({
      id: "provider",
      async generate(request) {
        return {
          text: request.prompt,
          providerId: request.providerId,
          modelId: request.modelId,
        };
      },
    });

    let beforeRunCalls = 0;
    let beforePersonaLoadCalls = 0;
    const unregistered: string[] = [];
    talos.onEvent((event) => {
      if (event.type === "plugin.unregistered") {
        unregistered.push(event.data.pluginId);
      }
    });

    await talos.registerPlugin({
      id: "ephemeral",
      capabilities: ["hooks"],
      setup(api) {
        api.on("beforeRun", () => {
          beforeRunCalls += 1;
        });
        api.on("beforePersonaLoad", (snapshot) => {
          beforePersonaLoadCalls += 1;
          return snapshot;
        });
      },
    });

    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "talos-plugin-hook-stop-"));
    try {
      await fs.writeFile(path.join(workspace, "SOUL.md"), "soul", "utf8");

      await talos.run({ agentId: "main", prompt: "one", workspaceDir: workspace });
      expect(beforeRunCalls).toBe(1);
      expect(beforePersonaLoadCalls).toBe(1);

      expect(await talos.removePlugin("ephemeral")).toBe(true);
      expect(unregistered).toContain("ephemeral");

      await talos.run({ agentId: "main", prompt: "two", workspaceDir: workspace });
      expect(beforeRunCalls).toBe(1);
      expect(beforePersonaLoadCalls).toBe(1);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it("runs plugin teardown during unload", async () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [
          {
            id: "openai",
            baseUrl: "https://api.openai.com/v1",
            defaultModel: "gpt-4o-mini",
          },
        ],
      },
    });

    let teardownCalls = 0;
    await talos.registerPlugin({
      id: "cleanup-plugin",
      capabilities: ["hooks"],
      setup(api) {
        api.on("beforeRun", () => undefined);
        return () => {
          teardownCalls += 1;
        };
      },
    });

    expect(await talos.removePlugin("cleanup-plugin")).toBe(true);
    expect(teardownCalls).toBe(1);
  });

  it("surfaces plugin teardown failures while still unloading plugin resources", async () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [
          {
            id: "openai",
            baseUrl: "https://api.openai.com/v1",
            defaultModel: "gpt-4o-mini",
          },
        ],
      },
    });

    await talos.registerPlugin({
      id: "broken-cleanup",
      capabilities: ["tools"],
      setup(api) {
        api.registerTool({
          name: "broken-tool",
          description: "temporary",
          async run() {
            return { content: "ok" };
          },
        });
        return () => {
          throw new Error("teardown failed");
        };
      },
    });

    await expect(talos.removePlugin("broken-cleanup")).rejects.toMatchObject({
      code: "PLUGIN_UNLOAD_FAILED",
    });
    expect(talos.hasPlugin("broken-cleanup")).toBe(false);
    expect(talos.hasTool("broken-tool")).toBe(false);
  });

  it("manages model provider lifecycle", () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [],
      },
    });

    talos.registerModelProvider({
      id: "provider-a",
      async generate(request) {
        return {
          text: "ok",
          providerId: request.providerId,
          modelId: request.modelId,
        };
      },
    });

    expect(talos.hasModelProvider("provider-a")).toBe(true);
    expect(talos.listModelProviders().map((provider) => provider.id)).toContain("provider-a");
    expect(talos.removeModelProvider("provider-a")).toBe(true);
    expect(talos.hasModelProvider("provider-a")).toBe(false);
  });

  it("manages auth profile lifecycle", () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [],
      },
    });

    talos.registerAuthProfile({
      id: "work",
      apiKey: "abc",
      headers: { "x-org": "team-a" },
    });

    expect(talos.hasAuthProfile("work")).toBe(true);
    expect(talos.listAuthProfiles().some((profile) => profile.id === "work")).toBe(true);
    expect(talos.removeAuthProfile("work")).toBe(true);
    expect(talos.hasAuthProfile("work")).toBe(false);
  });

  it("blocks plugin operations outside declared capabilities", async () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [
          {
            id: "openai",
            baseUrl: "https://api.openai.com/v1",
            defaultModel: "gpt-4o-mini",
          },
        ],
      },
    });

    await expect(
      talos.registerPlugin({
        id: "hooks-only",
        capabilities: ["hooks"],
        setup(api) {
          api.registerTool({
            name: "forbidden",
            description: "forbidden",
            async run() {
              return { content: "never" };
            },
          });
        },
      }),
    ).rejects.toMatchObject({ code: "PLUGIN_CAPABILITY_DENIED" });
  });

  it("rejects plugins with unsupported apiVersion", async () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [
          {
            id: "openai",
            baseUrl: "https://api.openai.com/v1",
            defaultModel: "gpt-4o-mini",
          },
        ],
      },
    });

    await expect(
      talos.registerPlugin({
        id: "future-plugin",
        apiVersion: 99,
        setup() {
          return undefined;
        },
      }),
    ).rejects.toMatchObject({ code: "PLUGIN_API_VERSION_UNSUPPORTED" });
  });

  it("emits plugin registration events", async () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [
          {
            id: "openai",
            baseUrl: "https://api.openai.com/v1",
            defaultModel: "gpt-4o-mini",
          },
        ],
      },
    });
    const events: string[] = [];
    talos.onEvent((event) => {
      events.push(event.type);
    });

    await talos.registerPlugin({
      id: "hooker",
      capabilities: ["hooks"],
      setup(api) {
        api.on("beforeRun", () => undefined);
      },
    });

    expect(events).toContain("plugin.registered");
  });

  it("supports event listener unsubscribe", async () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [
          {
            id: "openai",
            baseUrl: "https://api.openai.com/v1",
            defaultModel: "gpt-4o-mini",
          },
        ],
      },
    });

    const events: string[] = [];
    const unsubscribe = talos.onEvent((event) => {
      events.push(event.type);
    });

    await talos.registerPlugin({
      id: "hooker",
      capabilities: ["hooks"],
      setup(api) {
        api.on("beforeRun", () => undefined);
      },
    });
    expect(events).toContain("plugin.registered");

    const before = events.length;
    unsubscribe();

    await talos.registerPlugin({
      id: "hooker-2",
      capabilities: ["hooks"],
      setup(api) {
        api.on("beforeRun", () => undefined);
      },
    });

    expect(events.length).toBe(before);
  });

  it("uses fallback model attempts when primary provider fails", async () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [],
      },
    });

    talos.registerAgent({
      id: "main",
      model: {
        providerId: "primary",
        modelId: "one",
        fallbacks: [{ providerId: "secondary", modelId: "two" }],
      },
    });

    talos.registerModelProvider({
      id: "primary",
      async generate() {
        throw new Error("primary down");
      },
    });

    talos.registerModelProvider({
      id: "secondary",
      async generate(request) {
        return {
          text: "fallback ok",
          providerId: request.providerId,
          modelId: request.modelId,
        };
      },
    });

    const result = await talos.run({ agentId: "main", prompt: "hello" });

    expect(result.text).toBe("fallback ok");
    expect(result.providerId).toBe("secondary");
    expect(result.modelId).toBe("two");
  });

  it("emits run started/completed events", async () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [],
      },
    });
    const events: string[] = [];
    talos.onEvent((event) => {
      events.push(event.type);
    });

    talos.registerAgent({
      id: "main",
      model: { providerId: "provider", modelId: "model" },
    });
    talos.registerModelProvider({
      id: "provider",
      async generate(request) {
        return {
          text: "ok",
          providerId: request.providerId,
          modelId: request.modelId,
        };
      },
    });

    await talos.run({ agentId: "main", prompt: "hello" });

    expect(events).toContain("run.started");
    expect(events).toContain("run.completed");
  });

  it("emits run failed event", async () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [],
      },
    });
    const events: string[] = [];
    talos.onEvent((event) => {
      events.push(event.type);
    });

    talos.registerAgent({
      id: "main",
      model: { providerId: "provider", modelId: "model" },
    });
    talos.registerModelProvider({
      id: "provider",
      async generate() {
        throw new Error("down");
      },
    });

    await expect(talos.run({ agentId: "main", prompt: "hello" })).rejects.toMatchObject({
      code: "RUN_FAILED",
    });
    expect(events).toContain("run.started");
    expect(events).toContain("run.failed");
  });

  it("executes tools and emits tool lifecycle events", async () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [
          {
            id: "openai",
            baseUrl: "https://api.openai.com/v1",
            defaultModel: "gpt-4o-mini",
          },
        ],
      },
    });

    talos.registerTool({
      name: "sum",
      description: "sum two numbers",
      async run(args) {
        const a = Number(args.a ?? 0);
        const b = Number(args.b ?? 0);
        return { content: String(a + b) };
      },
    });

    const events: string[] = [];
    talos.onEvent((event) => {
      events.push(event.type);
    });

    const result = await talos.executeTool({
      name: "sum",
      args: { a: 2, b: 3 },
      context: { agentId: "main" },
    });

    expect(result.content).toBe("5");
    expect(events).toContain("tool.started");
    expect(events).toContain("tool.completed");
  });

  it("runs plugin beforeTool and afterTool hooks", async () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [
          {
            id: "openai",
            baseUrl: "https://api.openai.com/v1",
            defaultModel: "gpt-4o-mini",
          },
        ],
      },
    });

    talos.registerTool({
      name: "echo",
      description: "echo",
      async run(args) {
        return { content: String(args.value ?? "") };
      },
    });

    const calls: string[] = [];
    await talos.registerPlugin({
      id: "tool-hooks",
      capabilities: ["hooks"],
      setup(api) {
        api.on("beforeTool", () => {
          calls.push("beforeTool");
        });
        api.on("afterTool", () => {
          calls.push("afterTool");
        });
      },
    });

    const result = await talos.executeTool({
      name: "echo",
      args: { value: "hello" },
      context: { agentId: "main" },
    });

    expect(result.content).toBe("hello");
    expect(calls).toEqual(["beforeTool", "afterTool"]);
  });

  it("emits tool failed event when execution fails", async () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [
          {
            id: "openai",
            baseUrl: "https://api.openai.com/v1",
            defaultModel: "gpt-4o-mini",
          },
        ],
      },
    });

    talos.registerTool({
      name: "fail",
      description: "fails always",
      async run() {
        throw new Error("boom");
      },
    });

    const events: string[] = [];
    talos.onEvent((event) => {
      events.push(event.type);
    });

    await expect(
      talos.executeTool({
        name: "fail",
        context: { agentId: "main" },
      }),
    ).rejects.toMatchObject({ code: "TOOL_FAILED" });

    expect(events).toContain("tool.started");
    expect(events).toContain("tool.failed");
  });

  it("times out long-running tools", async () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [
          {
            id: "openai",
            baseUrl: "https://api.openai.com/v1",
            defaultModel: "gpt-4o-mini",
          },
        ],
      },
      tools: {
        executionTimeoutMs: 10,
      },
    });

    talos.registerTool({
      name: "sleepy",
      description: "sleeps",
      async run() {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return { content: "late" };
      },
    });

    await expect(
      talos.executeTool({
        name: "sleepy",
        context: { agentId: "main" },
      }),
    ).rejects.toMatchObject({ code: "TOOL_TIMEOUT" });
  });

  it("supports tool cancellation via AbortSignal", async () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [
          {
            id: "openai",
            baseUrl: "https://api.openai.com/v1",
            defaultModel: "gpt-4o-mini",
          },
        ],
      },
    });

    talos.registerTool({
      name: "wait",
      description: "waits",
      async run() {
        await new Promise((resolve) => setTimeout(resolve, 150));
        return { content: "done" };
      },
    });

    const events: string[] = [];
    talos.onEvent((event) => {
      events.push(event.type);
    });

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);

    await expect(
      talos.executeTool({
        name: "wait",
        context: { agentId: "main" },
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "TOOL_CANCELLED" });

    expect(events).toContain("tool.cancelled");
  });

  it("loads plugins from path and directory", async () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [
          {
            id: "openai",
            baseUrl: "https://api.openai.com/v1",
            defaultModel: "gpt-4o-mini",
          },
        ],
      },
    });

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "talos-load-plugins-"));
    try {
      const pluginAPath = path.join(tempDir, "plugin-a.mjs");
      const pluginBPath = path.join(tempDir, "plugin-b.mjs");
      await fs.writeFile(
        pluginAPath,
        "export default { id: 'loaded-a', capabilities: ['hooks'], async setup(api) { api.on('beforeRun', () => undefined); } };",
        "utf8",
      );
      await fs.writeFile(
        pluginBPath,
        "export default { id: 'loaded-b', capabilities: ['hooks'], async setup(api) { api.on('afterRun', () => undefined); } };",
        "utf8",
      );

      const events: string[] = [];
      talos.onEvent((event) => {
        if (event.type === "plugin.registered") {
          events.push(event.data.pluginId);
        }
      });

      await talos.loadPluginFromPath(pluginAPath);
      const loaded = await talos.loadPluginsFromDirectory(tempDir);

      expect(events).toContain("loaded-a");
      expect(events).toContain("loaded-b");
      expect(loaded).toContain("loaded-b");
      expect(loaded).not.toContain("loaded-a");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("enforces tool denylist", async () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [
          {
            id: "openai",
            baseUrl: "https://api.openai.com/v1",
            defaultModel: "gpt-4o-mini",
          },
        ],
      },
      tools: {
        deny: ["dangerous"],
      },
    });

    expect(() =>
      talos.registerTool({
        name: "dangerous",
        description: "blocked",
        async run() {
          return { content: "x" };
        },
      }),
    ).toThrowError(/Tool is denied by global configuration/);
  });

  it("enforces tool allowlist", async () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [
          {
            id: "openai",
            baseUrl: "https://api.openai.com/v1",
            defaultModel: "gpt-4o-mini",
          },
        ],
      },
      tools: {
        allow: ["safe"],
      },
    });

    expect(() =>
      talos.registerTool({
        name: "other",
        description: "blocked",
        async run() {
          return { content: "x" };
        },
      }),
    ).toThrowError(/Tool is not in global allowlist/);
  });

  it("enforces agent-level tool policy", async () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [
          {
            id: "openai",
            baseUrl: "https://api.openai.com/v1",
            defaultModel: "gpt-4o-mini",
          },
        ],
      },
    });

    talos.registerAgent({
      id: "restricted",
      tools: {
        allow: ["safe"],
      },
    });

    talos.registerTool({
      name: "unsafe",
      description: "unsafe",
      async run() {
        return { content: "x" };
      },
    });

    await expect(
      talos.executeTool({
        name: "unsafe",
        context: { agentId: "restricted" },
      }),
    ).rejects.toMatchObject({ code: "TOOL_NOT_ALLOWED" });
  });

  it("enforces run-level tool policy during run tool loops", async () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [],
      },
      models: {
        toolLoopMaxSteps: 1,
      },
    });

    talos.registerAgent({
      id: "main",
      model: { providerId: "provider", modelId: "m" },
    });
    talos.registerTool({
      name: "sum",
      description: "sum",
      async run(args) {
        return { content: String(Number(args.a ?? 0) + Number(args.b ?? 0)) };
      },
    });
    talos.registerModelProvider({
      id: "provider",
      async generate() {
        return {
          text: JSON.stringify({ tool: "sum", args: { a: 2, b: 3 } }),
          providerId: "provider",
          modelId: "m",
        };
      },
    });

    await expect(
      talos.run({
        agentId: "main",
        prompt: "Compute",
        tools: { deny: ["sum"] },
      }),
    ).rejects.toMatchObject({ code: "TOOL_NOT_ALLOWED" });
  });

  it("applies beforeModel hook overrides", async () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [],
      },
    });

    talos.registerAgent({
      id: "main",
      model: {
        providerId: "provider-a",
        modelId: "model-a",
      },
    });

    talos.registerModelProvider({
      id: "provider-a",
      async generate() {
        throw new Error("should be overridden");
      },
    });

    talos.registerModelProvider({
      id: "provider-b",
      async generate(request) {
        return {
          text: `from-${request.providerId}-${request.modelId}`,
          providerId: request.providerId,
          modelId: request.modelId,
        };
      },
    });

    await talos.registerPlugin({
      id: "model-override",
      capabilities: ["hooks"],
      setup(api) {
        api.on("beforeModel", (request) => ({
          ...request,
          providerId: "provider-b",
          modelId: "model-b",
        }));
      },
    });

    const result = await talos.run({ agentId: "main", prompt: "hello" });

    expect(result.text).toBe("from-provider-b-model-b");
    expect(result.providerId).toBe("provider-b");
    expect(result.modelId).toBe("model-b");
  });

  it("applies beforePersonaLoad hooks", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "talos-persona-hook-"));
    try {
      await fs.writeFile(path.join(workspace, "SOUL.md"), "original soul", "utf8");

      const talos = createTalos({
        providers: {
          openaiCompatible: [],
        },
      });

      talos.registerAgent({ id: "main", model: { providerId: "provider", modelId: "m" } });

      let seenSystem = "";
      talos.registerModelProvider({
        id: "provider",
        async generate(request) {
          seenSystem = request.system ?? "";
          return {
            text: "ok",
            providerId: request.providerId,
            modelId: request.modelId,
          };
        },
      });

      await talos.registerPlugin({
        id: "persona-hook",
        capabilities: ["hooks"],
        setup(api) {
          api.on("beforePersonaLoad", (snapshot) => ({
            ...snapshot,
            files: {
              ...snapshot.files,
              "SOUL.md": "patched soul",
            },
            bootstrapFiles: snapshot.bootstrapFiles.map((file) =>
              file.name === "SOUL.md" ? { ...file, content: "patched soul", missing: false } : file,
            ),
          }));
        },
      });

      await talos.run({
        agentId: "main",
        prompt: "hello",
        workspaceDir: workspace,
      });

      expect(seenSystem.includes("patched soul")).toBe(true);
      expect(seenSystem.includes("original soul")).toBe(false);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it("passes run context to beforePersonaLoad hooks", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "talos-persona-hook-context-"));
    try {
      await fs.writeFile(path.join(workspace, "SOUL.md"), "original soul", "utf8");

      const talos = createTalos({
        providers: {
          openaiCompatible: [],
        },
      });

      talos.registerAgent({ id: "main", model: { providerId: "provider", modelId: "m" } });
      talos.registerModelProvider({
        id: "provider",
        async generate(request) {
          return {
            text: request.system ?? "",
            providerId: request.providerId,
            modelId: request.modelId,
          };
        },
      });

      type PersonaHookContextCapture = {
        workspaceDir: string;
        agentId: string;
        sessionKey?: string;
        sessionId?: string;
        sessionKind: string;
        hasProviders: boolean;
      };
      const seen: PersonaHookContextCapture[] = [];

      await talos.registerPlugin({
        id: "persona-hook-context",
        capabilities: ["hooks"],
        setup(api) {
          api.on("beforePersonaLoad", (snapshot, context) => {
            seen.push({
              workspaceDir: context.workspaceDir,
              agentId: context.agentId,
              ...(context.sessionKey ? { sessionKey: context.sessionKey } : {}),
              ...(context.sessionId ? { sessionId: context.sessionId } : {}),
              sessionKind: context.sessionKind,
              hasProviders: context.config.providers.openaiCompatible.length > 0,
            });
            return snapshot;
          });
        },
      });

      await talos.run({
        agentId: "main",
        prompt: "hello",
        workspaceDir: workspace,
        sessionId: "agent:main:main",
      });

      expect(seen.length).toBe(1);
      const captured = seen[0] as PersonaHookContextCapture;
      expect(captured.workspaceDir.endsWith(path.basename(workspace))).toBe(true);
      expect(captured.agentId).toBe("main");
      expect(captured.sessionKey).toBe("agent:main:main");
      expect(captured.sessionId).toBe("agent:main:main");
      expect(captured.sessionKind).toBe("main");
      expect(captured.hasProviders).toBe(false);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it("ignores malformed bootstrap file paths from beforePersonaLoad hooks", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "talos-persona-hook-path-"));
    try {
      await fs.writeFile(path.join(workspace, "SOUL.md"), "original soul", "utf8");

      const talos = createTalos({
        providers: {
          openaiCompatible: [],
        },
      });

      talos.registerAgent({ id: "main", model: { providerId: "provider", modelId: "m" } });

      let seenSystem = "";
      talos.registerModelProvider({
        id: "provider",
        async generate(request) {
          seenSystem = request.system ?? "";
          return {
            text: "ok",
            providerId: request.providerId,
            modelId: request.modelId,
          };
        },
      });

      await talos.registerPlugin({
        id: "persona-malformed-path",
        capabilities: ["hooks"],
        setup(api) {
          api.on("beforePersonaLoad", (snapshot) => ({
            ...snapshot,
            bootstrapFiles: snapshot.bootstrapFiles.map((file) =>
              file.name === "SOUL.md" ? { ...file, path: "   ", content: "patched soul" } : file,
            ),
          }));
        },
      });

      const result = await talos.run({
        agentId: "main",
        prompt: "hello",
        workspaceDir: workspace,
      });

      expect(seenSystem.includes("patched soul")).toBe(false);
      expect(
        result.persona?.diagnostics.some((entry) =>
          entry.detail.includes("invalid path from hook override"),
        ),
      ).toBe(true);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it("trims bootstrap file paths from beforePersonaLoad hooks", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "talos-persona-hook-trim-"));
    try {
      const talos = createTalos({
        providers: {
          openaiCompatible: [],
        },
      });

      talos.registerAgent({ id: "main", model: { providerId: "provider", modelId: "m" } });

      let seenSystem = "";
      talos.registerModelProvider({
        id: "provider",
        async generate(request) {
          seenSystem = request.system ?? "";
          return {
            text: "ok",
            providerId: request.providerId,
            modelId: request.modelId,
          };
        },
      });

      await talos.registerPlugin({
        id: "persona-trimmed-path",
        capabilities: ["hooks"],
        setup(api) {
          api.on("beforePersonaLoad", (snapshot) => ({
            ...snapshot,
            bootstrapFiles: [
              ...snapshot.bootstrapFiles,
              {
                name: "USER.md",
                path: "   /virtual/missing-user.md   ",
                missing: true,
              },
            ],
          }));
        },
      });

      await talos.run({
        agentId: "main",
        prompt: "hello",
        workspaceDir: workspace,
      });

      expect(seenSystem.includes("   /virtual/missing-user.md   ")).toBe(false);
      expect(seenSystem.includes("[MISSING] Expected at: /virtual/missing-user.md")).toBe(true);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it("infers cron/subagent session kinds from canonical session ids", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "talos-persona-session-"));
    try {
      await fs.writeFile(path.join(workspace, "MEMORY.md"), "main memory", "utf8");
      await fs.writeFile(path.join(workspace, "AGENTS.md"), "agents", "utf8");

      const talos = createTalos({
        providers: {
          openaiCompatible: [],
        },
      });
      talos.registerAgent({ id: "main", model: { providerId: "provider", modelId: "m" } });

      const systems: string[] = [];
      talos.registerModelProvider({
        id: "provider",
        async generate(request) {
          systems.push(request.system ?? "");
          return {
            text: "ok",
            providerId: request.providerId,
            modelId: request.modelId,
          };
        },
      });

      await talos.run({
        agentId: "main",
        prompt: "hello",
        workspaceDir: workspace,
        sessionId: "agent:main:main",
      });
      await talos.run({
        agentId: "main",
        prompt: "hello",
        workspaceDir: workspace,
        sessionId: "agent:main:subagent:child-1",
      });
      await talos.run({
        agentId: "main",
        prompt: "hello",
        workspaceDir: workspace,
        sessionId: "agent:main:cron:daily",
      });

      expect(systems[0]?.includes("main memory")).toBe(true);
      expect(systems[1]?.includes("main memory")).toBe(false);
      expect(systems[2]?.includes("main memory")).toBe(false);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it("caches persona snapshots by session id", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "talos-persona-cache-"));
    try {
      await fs.writeFile(path.join(workspace, "SOUL.md"), "v1", "utf8");

      const talos = createTalos({
        providers: {
          openaiCompatible: [],
        },
      });
      talos.registerAgent({ id: "main", model: { providerId: "provider", modelId: "m" } });

      const systems: string[] = [];
      talos.registerModelProvider({
        id: "provider",
        async generate(request) {
          systems.push(request.system ?? "");
          return {
            text: "ok",
            providerId: request.providerId,
            modelId: request.modelId,
          };
        },
      });

      await talos.run({
        agentId: "main",
        prompt: "hello",
        workspaceDir: workspace,
        sessionId: "agent:main:main",
      });

      await fs.writeFile(path.join(workspace, "SOUL.md"), "v2", "utf8");

      await talos.run({
        agentId: "main",
        prompt: "hello",
        workspaceDir: workspace,
        sessionId: "agent:main:main",
      });
      await talos.run({
        agentId: "main",
        prompt: "hello",
        workspaceDir: workspace,
        sessionId: "agent:main:other",
      });

      expect(systems[0]?.includes("v1")).toBe(true);
      expect(systems[1]?.includes("v1")).toBe(true);
      expect(systems[1]?.includes("v2")).toBe(false);
      expect(systems[2]?.includes("v2")).toBe(true);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it("does not cache persona snapshots when session id is missing", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "talos-persona-cacheless-"));
    try {
      await fs.writeFile(path.join(workspace, "SOUL.md"), "v1", "utf8");

      const talos = createTalos({
        providers: {
          openaiCompatible: [],
        },
      });
      talos.registerAgent({ id: "main", model: { providerId: "provider", modelId: "m" } });

      const systems: string[] = [];
      talos.registerModelProvider({
        id: "provider",
        async generate(request) {
          systems.push(request.system ?? "");
          return {
            text: "ok",
            providerId: request.providerId,
            modelId: request.modelId,
          };
        },
      });

      await talos.run({
        agentId: "main",
        prompt: "hello",
        workspaceDir: workspace,
      });

      await fs.writeFile(path.join(workspace, "SOUL.md"), "v2", "utf8");

      await talos.run({
        agentId: "main",
        prompt: "hello",
        workspaceDir: workspace,
      });

      expect(systems[0]?.includes("v1")).toBe(true);
      expect(systems[1]?.includes("v2")).toBe(true);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it("loads configured extra persona files into system context", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "talos-persona-extra-"));
    try {
      await fs.mkdir(path.join(workspace, "nested"), { recursive: true });
      await fs.writeFile(path.join(workspace, "SOUL.md"), "root soul", "utf8");
      await fs.writeFile(path.join(workspace, "nested", "SOUL.md"), "nested soul", "utf8");

      const talos = createTalos({
        providers: {
          openaiCompatible: [],
        },
        persona: {
          extraFiles: ["nested/SOUL.md"],
        },
      });

      talos.registerAgent({ id: "main", model: { providerId: "provider", modelId: "m" } });

      let seenSystem = "";
      talos.registerModelProvider({
        id: "provider",
        async generate(request) {
          seenSystem = request.system ?? "";
          return {
            text: "ok",
            providerId: request.providerId,
            modelId: request.modelId,
          };
        },
      });

      await talos.run({
        agentId: "main",
        prompt: "hello",
        workspaceDir: workspace,
      });

      expect(seenSystem.includes("root soul")).toBe(true);
      expect(seenSystem.includes("nested soul")).toBe(true);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it("supports lightweight persona context mode for heartbeat runs", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "talos-persona-lightweight-heartbeat-"));
    try {
      await fs.writeFile(path.join(workspace, "SOUL.md"), "soul", "utf8");
      await fs.writeFile(path.join(workspace, "HEARTBEAT.md"), "heartbeat", "utf8");

      const talos = createTalos({
        providers: {
          openaiCompatible: [],
        },
      });
      talos.registerAgent({ id: "main", model: { providerId: "provider", modelId: "m" } });

      let seenSystem = "";
      talos.registerModelProvider({
        id: "provider",
        async generate(request) {
          seenSystem = request.system ?? "";
          return {
            text: "ok",
            providerId: request.providerId,
            modelId: request.modelId,
          };
        },
      });

      await talos.run({
        agentId: "main",
        prompt: "hello",
        workspaceDir: workspace,
        contextMode: "lightweight",
        runKind: "heartbeat",
      });

      expect(seenSystem.includes("heartbeat")).toBe(true);
      expect(seenSystem.includes("soul")).toBe(false);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it("supports lightweight persona context mode for cron/default runs", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "talos-persona-lightweight-cron-"));
    try {
      await fs.writeFile(path.join(workspace, "SOUL.md"), "soul", "utf8");
      await fs.writeFile(path.join(workspace, "HEARTBEAT.md"), "heartbeat", "utf8");

      const talos = createTalos({
        providers: {
          openaiCompatible: [],
        },
      });
      talos.registerAgent({ id: "main", model: { providerId: "provider", modelId: "m" } });

      let seenSystem = "unset";
      talos.registerModelProvider({
        id: "provider",
        async generate(request) {
          seenSystem = request.system ?? "";
          return {
            text: "ok",
            providerId: request.providerId,
            modelId: request.modelId,
          };
        },
      });

      await talos.run({
        agentId: "main",
        prompt: "hello",
        workspaceDir: workspace,
        contextMode: "lightweight",
        runKind: "cron",
      });

      expect(seenSystem).toBe("");
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it("emits model lifecycle events", async () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [],
      },
    });

    talos.registerAgent({
      id: "main",
      model: {
        providerId: "provider",
        modelId: "model",
      },
    });

    talos.registerModelProvider({
      id: "provider",
      async generate(request) {
        return {
          text: "ok",
          providerId: request.providerId,
          modelId: request.modelId,
        };
      },
    });

    const events: string[] = [];
    talos.onEvent((event) => {
      events.push(event.type);
    });

    await talos.run({ agentId: "main", prompt: "hello" });

    expect(events).toContain("model.started");
    expect(events).toContain("model.completed");
  });

  it("returns runId and includes it in run/model events", async () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [],
      },
    });

    talos.registerAgent({
      id: "main",
      model: {
        providerId: "provider",
        modelId: "model",
      },
    });
    talos.registerModelProvider({
      id: "provider",
      async generate(request) {
        return {
          text: "ok",
          providerId: request.providerId,
          modelId: request.modelId,
        };
      },
    });

    const runIds = new Set<string>();
    talos.onEvent((event) => {
      if (
        event.type === "run.started" ||
        event.type === "model.started" ||
        event.type === "model.completed" ||
        event.type === "run.completed"
      ) {
        runIds.add(event.runId);
      }
    });

    const result = await talos.run({ agentId: "main", prompt: "hello" });

    expect(result.runId.length).toBeGreaterThan(0);
    expect(runIds.size).toBe(1);
    expect(runIds.has(result.runId)).toBe(true);
  });

  it("lists recent events and run-specific events", async () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [],
      },
    });

    talos.registerAgent({
      id: "main",
      model: {
        providerId: "provider",
        modelId: "model",
      },
    });
    talos.registerModelProvider({
      id: "provider",
      async generate(request) {
        return {
          text: "ok",
          providerId: request.providerId,
          modelId: request.modelId,
        };
      },
    });

    const result = await talos.run({ agentId: "main", prompt: "hello" });
    const recent = talos.listEvents(5);
    const runEvents = talos.listRunEvents(result.runId);

    expect(recent.length).toBeGreaterThan(0);
    expect(runEvents.length).toBeGreaterThan(0);
    expect(runEvents.every((event) => "runId" in event && event.runId === result.runId)).toBe(true);
  });

  it("includes runId in tool events when provided in context", async () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [
          {
            id: "openai",
            baseUrl: "https://api.openai.com/v1",
            defaultModel: "gpt-4o-mini",
          },
        ],
      },
    });

    talos.registerTool({
      name: "echo",
      description: "echo",
      async run(args) {
        return { content: String(args.value ?? "") };
      },
    });

    const seenRunIds: string[] = [];
    talos.onEvent((event) => {
      if (event.type === "tool.started" || event.type === "tool.completed") {
        if (event.data.runId) {
          seenRunIds.push(event.data.runId);
        }
      }
    });

    await talos.executeTool({
      name: "echo",
      args: { value: "v" },
      context: { agentId: "main", runId: "run-123" },
    });

    expect(seenRunIds).toEqual(["run-123", "run-123"]);
  });

  it("cancels run before model execution when signal already aborted", async () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [],
      },
    });

    talos.registerAgent({
      id: "main",
      model: {
        providerId: "provider",
        modelId: "model",
      },
    });
    talos.registerModelProvider({
      id: "provider",
      async generate(request) {
        return {
          text: "ok",
          providerId: request.providerId,
          modelId: request.modelId,
        };
      },
    });

    const controller = new AbortController();
    controller.abort();

    await expect(
      talos.run({
        agentId: "main",
        prompt: "hello",
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "RUN_CANCELLED" });
  });

  it("emits run.cancelled when a run is aborted", async () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [],
      },
      models: {
        requestTimeoutMs: 500,
      },
    });

    talos.registerAgent({
      id: "main",
      model: {
        providerId: "slow",
        modelId: "model",
      },
    });
    talos.registerModelProvider({
      id: "slow",
      async generate() {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return {
          text: "late",
          providerId: "slow",
          modelId: "model",
        };
      },
    });

    const events: string[] = [];
    talos.onEvent((event) => {
      events.push(event.type);
    });

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);

    await expect(
      talos.run({
        agentId: "main",
        prompt: "hello",
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "RUN_CANCELLED" });

    expect(events).toContain("run.cancelled");
  });

  it("retries model requests before failing over", async () => {
    let primaryCalls = 0;
    const talos = createTalos({
      providers: {
        openaiCompatible: [],
      },
      models: {
        retriesPerModel: 1,
      },
    });

    talos.registerAgent({
      id: "main",
      model: {
        providerId: "primary",
        modelId: "one",
      },
    });

    talos.registerModelProvider({
      id: "primary",
      async generate(request) {
        primaryCalls += 1;
        if (primaryCalls === 1) {
          throw new Error("transient");
        }
        return {
          text: "ok-after-retry",
          providerId: request.providerId,
          modelId: request.modelId,
        };
      },
    });

    const result = await talos.run({ agentId: "main", prompt: "hello" });

    expect(primaryCalls).toBe(2);
    expect(result.text).toBe("ok-after-retry");
  });

  it("times out slow models and falls back", async () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [],
      },
      models: {
        requestTimeoutMs: 10,
      },
    });

    talos.registerAgent({
      id: "main",
      model: {
        providerId: "slow",
        modelId: "one",
        fallbacks: [{ providerId: "fast", modelId: "two" }],
      },
    });

    talos.registerModelProvider({
      id: "slow",
      async generate() {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return {
          text: "late",
          providerId: "slow",
          modelId: "one",
        };
      },
    });

    talos.registerModelProvider({
      id: "fast",
      async generate(request) {
        return {
          text: "fallback-fast",
          providerId: request.providerId,
          modelId: request.modelId,
        };
      },
    });

    const result = await talos.run({ agentId: "main", prompt: "hello" });

    expect(result.text).toBe("fallback-fast");
    expect(result.providerId).toBe("fast");
  });

  it("tracks active runs and supports cancellation by runId", async () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [],
      },
      models: {
        requestTimeoutMs: 1_000,
      },
    });

    talos.registerAgent({
      id: "main",
      model: {
        providerId: "slow",
        modelId: "m",
      },
    });
    talos.registerModelProvider({
      id: "slow",
      async generate() {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return {
          text: "late",
          providerId: "slow",
          modelId: "m",
        };
      },
    });

    const runPromise = talos.run({ agentId: "main", prompt: "hello" });
    await new Promise((resolve) => setTimeout(resolve, 10));

    const active = talos.listActiveRuns();
    expect(active.length).toBe(1);
    const runId = active[0]?.runId;
    expect(runId).toBeTruthy();
    expect(talos.cancelRun(runId ?? "")).toBe(true);
    await expect(runPromise).rejects.toMatchObject({ code: "RUN_CANCELLED" });
    expect(talos.listActiveRuns()).toHaveLength(0);
  });

  it("stores run summaries for completed runs", async () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [],
      },
    });
    talos.registerAgent({
      id: "main",
      model: { providerId: "provider", modelId: "model" },
    });
    talos.registerModelProvider({
      id: "provider",
      async generate(request) {
        return {
          text: "ok",
          providerId: request.providerId,
          modelId: request.modelId,
        };
      },
    });

    const result = await talos.run({ agentId: "main", prompt: "hello" });
    const summary = talos.getRun(result.runId);

    expect(summary?.status).toBe("completed");
    expect(summary?.providerId).toBe("provider");
    expect(summary?.modelId).toBe("model");
    expect(talos.listRuns(1)[0]?.runId).toBe(result.runId);
  });

  it("stores run summaries for cancelled runs", async () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [],
      },
    });
    talos.registerAgent({
      id: "main",
      model: { providerId: "slow", modelId: "model" },
    });
    talos.registerModelProvider({
      id: "slow",
      async generate() {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return {
          text: "late",
          providerId: "slow",
          modelId: "model",
        };
      },
    });

    const runPromise = talos.run({ agentId: "main", prompt: "hello" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const runId = talos.listActiveRuns()[0]?.runId ?? "";
    talos.cancelRun(runId);
    await expect(runPromise).rejects.toMatchObject({ code: "RUN_CANCELLED" });

    const summary = talos.getRun(runId);
    expect(summary?.status).toBe("cancelled");
    expect(summary?.finishedAt).toBeTruthy();
  });

  it("reports run status statistics", async () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [],
      },
      models: {
        requestTimeoutMs: 1_000,
      },
    });

    talos.registerAgent({
      id: "ok",
      model: { providerId: "ok-provider", modelId: "m" },
    });
    talos.registerModelProvider({
      id: "ok-provider",
      async generate(request) {
        return {
          text: "ok",
          providerId: request.providerId,
          modelId: request.modelId,
        };
      },
    });

    talos.registerAgent({
      id: "fail",
      model: { providerId: "fail-provider", modelId: "m" },
    });
    talos.registerModelProvider({
      id: "fail-provider",
      async generate() {
        throw new Error("boom");
      },
    });

    talos.registerAgent({
      id: "cancel",
      model: { providerId: "slow-provider", modelId: "m" },
    });
    talos.registerModelProvider({
      id: "slow-provider",
      async generate() {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return {
          text: "late",
          providerId: "slow-provider",
          modelId: "m",
        };
      },
    });

    await talos.run({ agentId: "ok", prompt: "hello" });
    await expect(talos.run({ agentId: "fail", prompt: "hello" })).rejects.toMatchObject({
      code: "RUN_FAILED",
    });

    const cancelPromise = talos.run({ agentId: "cancel", prompt: "hello" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const cancelRunId = talos.listActiveRuns()[0]?.runId ?? "";
    talos.cancelRun(cancelRunId);
    await expect(cancelPromise).rejects.toMatchObject({ code: "RUN_CANCELLED" });

    const stats = talos.getRunStats();
    expect(stats.total).toBeGreaterThanOrEqual(3);
    expect(stats.completed).toBeGreaterThanOrEqual(1);
    expect(stats.failed).toBeGreaterThanOrEqual(1);
    expect(stats.cancelled).toBeGreaterThanOrEqual(1);
  });

  it("returns diagnostics snapshot with counts and recent events", async () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [],
      },
    });

    talos.registerAgent({ id: "main", model: { providerId: "provider", modelId: "m" } });
    talos.registerTool({
      name: "echo",
      description: "echo",
      async run(args) {
        return { content: String(args.value ?? "") };
      },
    });
    talos.registerModelProvider({
      id: "provider",
      async generate(request) {
        return {
          text: "ok",
          providerId: request.providerId,
          modelId: request.modelId,
        };
      },
    });

    await talos.run({ agentId: "main", prompt: "hello" });
    await talos.executeTool({ name: "echo", args: { value: "v" }, context: { agentId: "main" } });

    const snapshot = talos.getDiagnostics({ recentEventsLimit: 5 });

    expect(snapshot.generatedAt.length).toBeGreaterThan(0);
    expect(snapshot.counts.agents).toBe(1);
    expect(snapshot.counts.tools).toBe(1);
    expect(snapshot.counts.providers).toBe(1);
    expect(snapshot.recentEvents.length).toBeLessThanOrEqual(5);
    expect(snapshot.runStats.total).toBeGreaterThanOrEqual(1);
  });

  it("resets diagnostics history and run summaries", async () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [],
      },
    });

    talos.registerAgent({ id: "main", model: { providerId: "provider", modelId: "m" } });
    talos.registerModelProvider({
      id: "provider",
      async generate(request) {
        return {
          text: "ok",
          providerId: request.providerId,
          modelId: request.modelId,
        };
      },
    });

    await talos.run({ agentId: "main", prompt: "hello" });

    const before = talos.getDiagnostics();
    expect(before.runStats.total).toBeGreaterThan(0);
    expect(before.recentEvents.length).toBeGreaterThan(0);

    const reset = talos.resetDiagnostics();
    expect(reset.clearedRuns).toBeGreaterThan(0);
    expect(reset.clearedEvents).toBeGreaterThan(0);

    const after = talos.getDiagnostics();
    expect(after.runStats.total).toBe(0);
    expect(after.recentEvents).toHaveLength(0);
  });

  it("queries runs by agent and status", async () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [],
      },
      models: {
        requestTimeoutMs: 1_000,
      },
    });

    talos.registerAgent({
      id: "alpha",
      model: { providerId: "ok", modelId: "m" },
    });
    talos.registerAgent({
      id: "beta",
      model: { providerId: "bad", modelId: "m" },
    });

    talos.registerModelProvider({
      id: "ok",
      async generate(request) {
        return {
          text: "ok",
          providerId: request.providerId,
          modelId: request.modelId,
        };
      },
    });
    talos.registerModelProvider({
      id: "bad",
      async generate() {
        throw new Error("boom");
      },
    });

    await talos.run({ agentId: "alpha", prompt: "hello" });
    await expect(talos.run({ agentId: "beta", prompt: "hello" })).rejects.toMatchObject({
      code: "RUN_FAILED",
    });

    const alphaCompleted = talos.queryRuns({ agentId: "alpha", status: "completed" });
    const betaFailed = talos.queryRuns({ agentId: "beta", status: "failed" });

    expect(alphaCompleted.length).toBeGreaterThanOrEqual(1);
    expect(alphaCompleted.every((run) => run.agentId === "alpha")).toBe(true);
    expect(alphaCompleted.every((run) => run.status === "completed")).toBe(true);

    expect(betaFailed.length).toBeGreaterThanOrEqual(1);
    expect(betaFailed.every((run) => run.agentId === "beta")).toBe(true);
    expect(betaFailed.every((run) => run.status === "failed")).toBe(true);

    const before = new Date(Date.now() - 1_000).toISOString();
    const after = new Date(Date.now() + 1_000).toISOString();
    const inWindow = talos.queryRuns({ since: before, until: after });
    expect(inWindow.length).toBeGreaterThanOrEqual(2);

    const futureOnly = talos.queryRuns({ since: new Date(Date.now() + 60_000).toISOString() });
    expect(futureOnly).toHaveLength(0);
  });

  it("queries events by type and runId", async () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [],
      },
    });

    talos.registerAgent({ id: "main", model: { providerId: "provider", modelId: "m" } });
    talos.registerModelProvider({
      id: "provider",
      async generate(request) {
        return {
          text: "ok",
          providerId: request.providerId,
          modelId: request.modelId,
        };
      },
    });

    const result = await talos.run({ agentId: "main", prompt: "hello" });

    const completed = talos.queryEvents({ type: "run.completed" });
    expect(completed.length).toBeGreaterThanOrEqual(1);

    const byRun = talos.queryEvents({ runId: result.runId });
    expect(byRun.length).toBeGreaterThan(0);
    expect(byRun.every((event) => ("runId" in event ? event.runId === result.runId : true))).toBe(
      true,
    );

    const before = new Date(Date.now() - 1_000).toISOString();
    const after = new Date(Date.now() + 1_000).toISOString();
    const inRange = talos.queryEvents({ runId: result.runId, since: before, until: after });
    expect(inRange.length).toBeGreaterThan(0);

    const futureRange = talos.queryEvents({
      runId: result.runId,
      since: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(futureRange).toHaveLength(0);
  });

  it("executes tool loop rounds when model returns JSON tool calls", async () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [],
      },
      models: {
        toolLoopMaxSteps: 2,
      },
    });

    talos.registerAgent({ id: "main", model: { providerId: "provider", modelId: "m" } });
    talos.registerTool({
      name: "sum",
      description: "sum",
      async run(args) {
        return { content: String(Number(args.a ?? 0) + Number(args.b ?? 0)) };
      },
    });

    let calls = 0;
    talos.registerModelProvider({
      id: "provider",
      async generate() {
        calls += 1;
        if (calls === 1) {
          return {
            text: JSON.stringify({ tool: "sum", args: { a: 2, b: 3 } }),
            providerId: "provider",
            modelId: "m",
          };
        }
        return {
          text: "The answer is 5.",
          providerId: "provider",
          modelId: "m",
        };
      },
    });

    const result = await talos.run({ agentId: "main", prompt: "What is 2+3?" });
    expect(result.text).toBe("The answer is 5.");
    expect(calls).toBe(2);
  });

  it("saves and loads state snapshots", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "talos-state-"));
    const statePath = path.join(stateDir, "state.json");
    try {
      const talosA = createTalos({
        providers: {
          openaiCompatible: [],
        },
      });
      talosA.registerAgent({ id: "main", model: { providerId: "provider", modelId: "m" } });
      talosA.registerModelProvider({
        id: "provider",
        async generate(request) {
          return {
            text: "ok",
            providerId: request.providerId,
            modelId: request.modelId,
          };
        },
      });
      await talosA.run({ agentId: "main", prompt: "hello" });
      await talosA.saveState(statePath);

      const talosB = createTalos({
        providers: {
          openaiCompatible: [],
        },
      });
      const loadedPath = await talosB.loadState(statePath);
      expect(loadedPath.endsWith("state.json")).toBe(true);
      expect(talosB.getRunStats().total).toBeGreaterThanOrEqual(1);
      expect(talosB.listEvents(10).length).toBeGreaterThan(0);
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });

  it("redacts configured keys when saving state snapshots", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "talos-redact-state-"));
    const statePath = path.join(stateDir, "state.json");
    try {
      const talos = createTalos({
        security: {
          redactKeys: ["authorization"],
        },
        providers: {
          openaiCompatible: [],
        },
      });

      talos.onEvent((event) => {
        if (event.type === "run.failed") {
          Object.assign(event.data, {
            authorization: "secret-token",
          });
        }
      });

      talos.registerAgent({
        id: "main",
        model: { providerId: "bad", modelId: "m" },
      });
      talos.registerModelProvider({
        id: "bad",
        async generate() {
          throw new Error("authorization=secret-token");
        },
      });

      await expect(talos.run({ agentId: "main", prompt: "x" })).rejects.toMatchObject({
        code: "RUN_FAILED",
      });
      await talos.saveState(statePath);

      const raw = await fs.readFile(statePath, "utf8");
      expect(raw.includes('"authorization": "[REDACTED]"')).toBe(true);
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });

  it("auto-persists and auto-loads state when runtime.stateFile is configured", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "talos-auto-state-"));
    const statePath = path.join(stateDir, "state.json");

    const waitFor = async (predicate: () => boolean | Promise<boolean>, timeoutMs = 2_000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (await predicate()) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error("Timed out waiting for condition.");
    };

    try {
      const talosA = createTalos({
        runtime: {
          stateFile: statePath,
        },
        providers: {
          openaiCompatible: [],
        },
      });
      talosA.registerAgent({ id: "main", model: { providerId: "provider", modelId: "m" } });
      talosA.registerModelProvider({
        id: "provider",
        async generate(request) {
          return {
            text: "ok",
            providerId: request.providerId,
            modelId: request.modelId,
          };
        },
      });
      await talosA.run({ agentId: "main", prompt: "hello" });

      await waitFor(async () => {
        try {
          await fs.access(statePath);
          return true;
        } catch {
          return false;
        }
      });

      const talosB = createTalos({
        runtime: {
          stateFile: statePath,
        },
        providers: {
          openaiCompatible: [],
        },
      });

      await waitFor(() => talosB.getRunStats().total > 0);
      expect(talosB.getRunStats().total).toBeGreaterThanOrEqual(1);
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });
});
