import { describe, expect, it } from "vitest";
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
    expect(typeof talos.registerTool).toBe("function");
    expect(typeof talos.registerPlugin).toBe("function");
    expect(typeof talos.onEvent).toBe("function");
    expect(typeof talos.run).toBe("function");
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
});
