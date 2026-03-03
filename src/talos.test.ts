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
    expect(typeof talos.listTools).toBe("function");
    expect(typeof talos.hasTool).toBe("function");
    expect(typeof talos.removeTool).toBe("function");
    expect(typeof talos.registerPlugin).toBe("function");
    expect(typeof talos.removePlugin).toBe("function");
    expect(typeof talos.listPlugins).toBe("function");
    expect(typeof talos.hasPlugin).toBe("function");
    expect(typeof talos.listModelProviders).toBe("function");
    expect(typeof talos.hasModelProvider).toBe("function");
    expect(typeof talos.removeModelProvider).toBe("function");
    expect(typeof talos.onEvent).toBe("function");
    expect(typeof talos.seedPersonaWorkspace).toBe("function");
    expect(typeof talos.listRuns).toBe("function");
    expect(typeof talos.getRun).toBe("function");
    expect(typeof talos.getRunStats).toBe("function");
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
      },
    });

    expect(talos.hasPlugin("hooks-one")).toBe(true);
    expect(talos.listPlugins()).toContain("hooks-one");
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
      },
    });

    await talos.run({ agentId: "main", prompt: "one" });
    expect(beforeRunCalls).toBe(1);

    expect(await talos.removePlugin("ephemeral")).toBe(true);
    expect(unregistered).toContain("ephemeral");

    await talos.run({ agentId: "main", prompt: "two" });
    expect(beforeRunCalls).toBe(1);
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
    ).toThrowError(/Tool is denied by configuration/);
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
    ).toThrowError(/Tool is not in allowlist/);
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
});
