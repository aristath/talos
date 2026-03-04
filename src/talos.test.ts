import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTalos } from "./talos.js";

describe("createTalos", () => {
  it("exposes runtime APIs without tool surface", () => {
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
    expect(typeof talos.registerPlugin).toBe("function");
    expect(typeof talos.registerModelProvider).toBe("function");
    expect(typeof talos.run).toBe("function");
    expect((talos as { registerTool?: unknown }).registerTool).toBeUndefined();
    expect((talos as { executeTool?: unknown }).executeTool).toBeUndefined();
  });

  it("manages agent lifecycle", () => {
    const talos = createTalos({
      providers: {
        openaiCompatible: [],
      },
    });

    talos.registerAgent({ id: "main", name: "Main" });
    expect(talos.hasAgent("main")).toBe(true);
    expect(talos.listAgents().map((agent) => agent.id)).toContain("main");
    expect(talos.removeAgent("main")).toBe(true);
    expect(talos.hasAgent("main")).toBe(false);
  });

  it("manages plugin lifecycle and summaries", async () => {
    const talos = createTalos({ providers: { openaiCompatible: [] } });

    await talos.registerPlugin({
      id: "summary-plugin",
      capabilities: ["providers", "hooks"],
      setup(api) {
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
      },
    });

    const summary = talos.getPluginSummary("summary-plugin");
    expect(summary?.providerCount).toBe(1);
    expect(summary?.hooks).toContain("beforeRun");

    expect(await talos.removePlugin("summary-plugin")).toBe(true);
    expect(talos.hasModelProvider("summary-provider")).toBe(false);
  });

  it("rejects capability violations for providers/hooks", async () => {
    const talos = createTalos({ providers: { openaiCompatible: [] } });

    await expect(
      talos.registerPlugin({
        id: "providers-denied",
        capabilities: ["hooks"],
        setup(api) {
          api.registerModelProvider({
            id: "should-fail",
            async generate(request) {
              return {
                text: "nope",
                providerId: request.providerId,
                modelId: request.modelId,
              };
            },
          });
        },
      }),
    ).rejects.toMatchObject({ code: "PLUGIN_CAPABILITY_DENIED" });
  });

  it("runs model with fallback providers", async () => {
    const talos = createTalos({ providers: { openaiCompatible: [] } });
    talos.registerAgent({
      id: "main",
      model: {
        providerId: "p1",
        modelId: "m1",
        fallbacks: [{ providerId: "p2", modelId: "m2" }],
      },
    });

    talos.registerModelProvider({
      id: "p1",
      async generate() {
        throw new Error("primary failed");
      },
    });
    talos.registerModelProvider({
      id: "p2",
      async generate(request) {
        return {
          text: "ok",
          providerId: request.providerId,
          modelId: request.modelId,
        };
      },
    });

    const result = await talos.run({ agentId: "main", prompt: "hello" });
    expect(result.providerId).toBe("p2");
    expect(result.modelId).toBe("m2");
  });

  it("applies beforeModel and beforePersonaLoad hooks", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "talos-hook-"));
    try {
      await fs.writeFile(path.join(workspace, "SOUL.md"), "original", "utf8");
      const talos = createTalos({ providers: { openaiCompatible: [] } });
      talos.registerAgent({ id: "main", model: { providerId: "p", modelId: "m" } });

      let seenSystem = "";
      talos.registerModelProvider({
        id: "p2",
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
        id: "hooks",
        capabilities: ["hooks"],
        setup(api) {
          api.on("beforePersonaLoad", (snapshot) => ({
            ...snapshot,
            bootstrapFiles: snapshot.bootstrapFiles.map((file) =>
              file.name === "SOUL.md" ? { ...file, content: "patched", missing: false } : file,
            ),
          }));
          api.on("beforeModel", (request) => ({ ...request, providerId: "p2", modelId: "m2" }));
        },
      });

      const result = await talos.run({ agentId: "main", prompt: "hello", workspaceDir: workspace });
      expect(result.providerId).toBe("p2");
      expect(seenSystem.includes("patched")).toBe(true);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it("passes beforePersonaLoad context including session key", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "talos-hook-ctx-"));
    try {
      await fs.writeFile(path.join(workspace, "SOUL.md"), "x", "utf8");
      const talos = createTalos({ providers: { openaiCompatible: [] } });
      talos.registerAgent({ id: "main", model: { providerId: "p", modelId: "m" } });
      talos.registerModelProvider({
        id: "p",
        async generate(request) {
          return {
            text: request.prompt,
            providerId: request.providerId,
            modelId: request.modelId,
          };
        },
      });

      let seenSessionKey = "";
      await talos.registerPlugin({
        id: "ctx",
        capabilities: ["hooks"],
        setup(api) {
          api.on("beforePersonaLoad", (snapshot, context) => {
            seenSessionKey = context.sessionKey ?? "";
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
      expect(seenSessionKey).toBe("agent:main:main");
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it("caches persona snapshots by session id", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "talos-cache-"));
    try {
      await fs.writeFile(path.join(workspace, "SOUL.md"), "v1", "utf8");
      const talos = createTalos({ providers: { openaiCompatible: [] } });
      talos.registerAgent({ id: "main", model: { providerId: "p", modelId: "m" } });

      const systems: string[] = [];
      talos.registerModelProvider({
        id: "p",
        async generate(request) {
          systems.push(request.system ?? "");
          return {
            text: "ok",
            providerId: request.providerId,
            modelId: request.modelId,
          };
        },
      });

      await talos.run({ agentId: "main", prompt: "one", workspaceDir: workspace, sessionId: "a" });
      await fs.writeFile(path.join(workspace, "SOUL.md"), "v2", "utf8");
      await talos.run({ agentId: "main", prompt: "two", workspaceDir: workspace, sessionId: "a" });
      await talos.run({ agentId: "main", prompt: "three", workspaceDir: workspace, sessionId: "b" });

      expect(systems[0]?.includes("v1")).toBe(true);
      expect(systems[1]?.includes("v1")).toBe(true);
      expect(systems[2]?.includes("v2")).toBe(true);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it("supports lightweight persona context mode", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "talos-light-"));
    try {
      await fs.writeFile(path.join(workspace, "SOUL.md"), "soul", "utf8");
      await fs.writeFile(path.join(workspace, "HEARTBEAT.md"), "heartbeat", "utf8");
      const talos = createTalos({ providers: { openaiCompatible: [] } });
      talos.registerAgent({ id: "main", model: { providerId: "p", modelId: "m" } });
      let seenSystem = "";
      talos.registerModelProvider({
        id: "p",
        async generate(request) {
          seenSystem = request.system ?? "";
          return { text: "ok", providerId: request.providerId, modelId: request.modelId };
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

  it("tracks events, run summaries, and diagnostics", async () => {
    const talos = createTalos({ providers: { openaiCompatible: [] } });
    talos.registerAgent({ id: "main", model: { providerId: "p", modelId: "m" } });
    talos.registerModelProvider({
      id: "p",
      async generate(request) {
        return { text: "ok", providerId: request.providerId, modelId: request.modelId };
      },
    });

    const result = await talos.run({ agentId: "main", prompt: "hello" });
    expect(talos.listRunEvents(result.runId).length).toBeGreaterThan(0);
    expect(talos.getRun(result.runId)?.status).toBe("completed");
    const diagnostics = talos.getDiagnostics();
    expect(diagnostics.counts.agents).toBe(1);
    expect(diagnostics.counts.providers).toBeGreaterThan(0);
  });

  it("supports run cancellation", async () => {
    const talos = createTalos({ providers: { openaiCompatible: [] } });
    talos.registerAgent({ id: "main", model: { providerId: "slow", modelId: "m" } });
    talos.registerModelProvider({
      id: "slow",
      async generate(request) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return { text: "ok", providerId: request.providerId, modelId: request.modelId };
      },
    });

    const controller = new AbortController();
    const promise = talos.run({ agentId: "main", prompt: "hello", signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ code: "RUN_CANCELLED" });
  });

  it("saves and loads state snapshots", async () => {
    const stateFile = path.join(os.tmpdir(), `talos-state-${Date.now().toString(36)}.json`);
    const talos = createTalos({ providers: { openaiCompatible: [] } });
    talos.registerAgent({ id: "main", model: { providerId: "p", modelId: "m" } });
    talos.registerModelProvider({
      id: "p",
      async generate(request) {
        return { text: "ok", providerId: request.providerId, modelId: request.modelId };
      },
    });
    await talos.run({ agentId: "main", prompt: "hello" });
    await talos.saveState(stateFile);

    const restored = createTalos({ providers: { openaiCompatible: [] }, runtime: { stateFile } });
    await restored.loadState(stateFile);
    expect(restored.listEvents().length).toBeGreaterThan(0);
    await fs.rm(stateFile, { force: true });
  });
});
