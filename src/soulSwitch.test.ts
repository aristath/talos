import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createSoulSwitch } from "./soulSwitch.js";

describe("createSoulSwitch", () => {
  it("loads per-agent SOUL and static upstream auth from agents/<id>/agent.json", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "soulSwitch-agent-profile-"));
    await fs.writeFile(path.join(workspaceDir, "SOUL.md"), "Root soul", "utf8");
    const agentDir = path.join(workspaceDir, "agents", "main");
    await fs.mkdir(agentDir, { recursive: true });
    await fs.writeFile(path.join(agentDir, "SOUL.md"), "Designer soul", "utf8");
    await fs.writeFile(
      path.join(agentDir, "agent.json"),
      JSON.stringify(
        {
          upstream: {
            providerId: "openai",
            baseURL: "https://openrouter.ai/api/v1",
            headers: {
              "x-agent": "designer",
            },
            auth: {
              type: "static",
              apiKey: "sk-hardcoded",
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

    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: "ok",
                },
              },
            ],
          };
        },
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const soulSwitch = createSoulSwitch({
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
    soulSwitch.registerAgent({ id: "main" });

    const result = await soulSwitch.run({
      agentId: "main",
      prompt: "hello",
      workspaceDir,
    });

    expect(result.providerId).toBe("openai");
    expect(result.modelId).toBe("openai/gpt-4.1");

    const calls = fetchMock.mock.calls as unknown as Array<[unknown, unknown?]>;
    const url = String(calls[0]?.[0] ?? "");
    const init = (calls[0]?.[1] ?? {}) as {
      headers?: Record<string, string>;
      body?: string;
    };
    const payload = JSON.parse(init.body ?? "{}") as {
      model?: string;
      messages?: Array<{ role?: string; content?: string }>;
    };
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(init.headers?.authorization).toBe("Bearer sk-hardcoded");
    expect(init.headers?.["x-agent"]).toBe("designer");
    expect(payload.model).toBe("openai/gpt-4.1");
    expect(payload.messages?.[0]?.role).toBe("system");
    expect(payload.messages?.[0]?.content).toContain("Designer soul");
    expect(payload.messages?.[0]?.content).not.toContain("Root soul");

    vi.unstubAllGlobals();
  });

  it("creates an engine with registration APIs", () => {
    const soulSwitch = createSoulSwitch({
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

    expect(typeof soulSwitch.registerAgent).toBe("function");
    expect(typeof soulSwitch.listAgents).toBe("function");
    expect(typeof soulSwitch.hasAgent).toBe("function");
    expect(typeof soulSwitch.removeAgent).toBe("function");
    expect(typeof soulSwitch.registerTool).toBe("function");
    expect(typeof soulSwitch.registerWebTools).toBe("function");
    expect(typeof soulSwitch.registerMediaTools).toBe("function");
    expect(typeof soulSwitch.registerBrowserTools).toBe("function");
    expect(typeof soulSwitch.registerCanvasTools).toBe("function");
    expect(typeof soulSwitch.registerSessionTools).toBe("function");
    expect(typeof soulSwitch.registerLlmTaskTool).toBe("function");
    expect(typeof soulSwitch.listTools).toBe("function");
    expect(typeof soulSwitch.hasTool).toBe("function");
    expect(typeof soulSwitch.removeTool).toBe("function");
    expect(typeof soulSwitch.registerPlugin).toBe("function");
    expect(typeof soulSwitch.removePlugin).toBe("function");
    expect(typeof soulSwitch.listPlugins).toBe("function");
    expect(typeof soulSwitch.listPluginSummaries).toBe("function");
    expect(typeof soulSwitch.getPluginSummary).toBe("function");
    expect(typeof soulSwitch.hasPlugin).toBe("function");
    expect(typeof soulSwitch.listModelProviders).toBe("function");
    expect(typeof soulSwitch.hasModelProvider).toBe("function");
    expect(typeof soulSwitch.removeModelProvider).toBe("function");
    expect(typeof soulSwitch.registerAuthProfile).toBe("function");
    expect(typeof soulSwitch.listAuthProfiles).toBe("function");
    expect(typeof soulSwitch.hasAuthProfile).toBe("function");
    expect(typeof soulSwitch.removeAuthProfile).toBe("function");
    expect(typeof soulSwitch.onEvent).toBe("function");
    expect(typeof soulSwitch.seedPersonaWorkspace).toBe("function");
    expect(typeof soulSwitch.listRuns).toBe("function");
    expect(typeof soulSwitch.queryRuns).toBe("function");
    expect(typeof soulSwitch.getRun).toBe("function");
    expect(typeof soulSwitch.getRunStats).toBe("function");
    expect(typeof soulSwitch.getDiagnostics).toBe("function");
    expect(typeof soulSwitch.resetDiagnostics).toBe("function");
    expect(typeof soulSwitch.queryEvents).toBe("function");
    expect(typeof soulSwitch.run).toBe("function");
  });

  it("manages agent lifecycle in registry", () => {
    const soulSwitch = createSoulSwitch({
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

    soulSwitch.registerAgent({ id: "main", name: "Main" });
    expect(soulSwitch.hasAgent("main")).toBe(true);
    expect(soulSwitch.listAgents().map((agent) => agent.id)).toContain("main");
    expect(soulSwitch.removeAgent("main")).toBe(true);
    expect(soulSwitch.hasAgent("main")).toBe(false);
  });

  it("manages tool lifecycle in registry", async () => {
    const soulSwitch = createSoulSwitch({
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

    soulSwitch.registerTool({
      name: "echo",
      description: "echo",
      async run(args) {
        return { content: String(args.value ?? "") };
      },
    });

    expect(soulSwitch.hasTool("echo")).toBe(true);
    expect(soulSwitch.listTools().map((tool) => tool.name)).toContain("echo");
    expect(soulSwitch.removeTool("echo")).toBe(true);
    expect(soulSwitch.hasTool("echo")).toBe(false);
  });

  it("registers web tools and executes web_search", async () => {
    const soulSwitch = createSoulSwitch({
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

    soulSwitch.registerWebTools({
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

    const search = await soulSwitch.executeTool({
      name: "web_search",
      args: {
        query: "soulSwitch",
      },
      context: { agentId: "main" },
    });
    const fetched = await soulSwitch.executeTool({
      name: "web_fetch",
      args: {
        url: "https://example.com",
      },
      context: { agentId: "main" },
    });

    expect(search.content).toContain("Result for soulSwitch");
    expect(fetched.content).toContain("Fetched https://example.com");
    expect((search.data as { details?: { resultCount?: number } }).details?.resultCount).toBe(1);
    expect((fetched.data as { details?: { url?: string } }).details?.url).toBe("https://example.com/");
  });

  it("validates web_search locale and freshness parameters", async () => {
    const soulSwitch = createSoulSwitch({
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

    soulSwitch.registerWebTools({
      search: {
        search: async () => [],
      },
    });

    await expect(
      soulSwitch.executeTool({
        name: "web_search",
        args: {
          query: "soulSwitch",
          search_lang: "en-US",
        },
        context: { agentId: "main" },
      }),
    ).rejects.toMatchObject({ code: "TOOL_FAILED" });

    await expect(
      soulSwitch.executeTool({
        name: "web_search",
        args: {
          query: "soulSwitch",
          freshness: "yesterday",
        },
        context: { agentId: "main" },
      }),
    ).rejects.toMatchObject({ code: "TOOL_FAILED" });

    await expect(
      soulSwitch.executeTool({
        name: "web_search",
        args: {
          query: "soulSwitch",
          provider: "bing",
        },
        context: { agentId: "main" },
      }),
    ).rejects.toMatchObject({ code: "TOOL_FAILED" });
  });

  it("caches web_search and web_fetch responses", async () => {
    const soulSwitch = createSoulSwitch({
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

    let searchCalls = 0;
    let fetchCalls = 0;
    let lastProvider = "";
    soulSwitch.registerWebTools({
      search: {
        search: async ({ query, provider }) => {
          searchCalls += 1;
          lastProvider = provider ?? "";
          return [{ title: query, url: "https://example.com" }];
        },
      },
      fetch: {
        fetchContent: async ({ url, maxResponseBytes }) => {
          fetchCalls += 1;
          return { content: `body:${url}:${maxResponseBytes}` };
        },
      },
    });

    await soulSwitch.executeTool({
      name: "web_search",
      args: { query: "cache-me", provider: "brave" },
      context: { agentId: "main" },
    });
    await soulSwitch.executeTool({
      name: "web_search",
      args: { query: "cache-me", provider: "brave" },
      context: { agentId: "main" },
    });
    await soulSwitch.executeTool({
      name: "web_fetch",
      args: { url: "https://example.com" },
      context: { agentId: "main" },
    });
    await soulSwitch.executeTool({
      name: "web_fetch",
      args: { url: "https://example.com" },
      context: { agentId: "main" },
    });

    expect(searchCalls).toBe(1);
    expect(fetchCalls).toBe(1);
    expect(lastProvider).toBe("brave");
  });

  it("auto-detects web_search provider from environment", async () => {
    const previousBrave = process.env.BRAVE_API_KEY;
    const previousGemini = process.env.GEMINI_API_KEY;
    process.env.BRAVE_API_KEY = "brave-key";
    delete process.env.GEMINI_API_KEY;
    try {
      const soulSwitch = createSoulSwitch({
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

      let seenProvider = "";
      soulSwitch.registerWebTools({
        search: {
          search: async ({ provider }) => {
            seenProvider = provider ?? "";
            return [];
          },
        },
      });

      await soulSwitch.executeTool({
        name: "web_search",
        args: { query: "hello" },
        context: { agentId: "main" },
      });

      expect(seenProvider).toBe("brave");
    } finally {
      if (typeof previousBrave === "string") {
        process.env.BRAVE_API_KEY = previousBrave;
      } else {
        delete process.env.BRAVE_API_KEY;
      }
      if (typeof previousGemini === "string") {
        process.env.GEMINI_API_KEY = previousGemini;
      } else {
        delete process.env.GEMINI_API_KEY;
      }
    }
  });

  it("prefers configured default web_search provider over env autodetect", async () => {
    const prevBrave = process.env.BRAVE_API_KEY;
    process.env.BRAVE_API_KEY = "brave-key";
    try {
      const soulSwitch = createSoulSwitch({
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

      let seenProvider = "";
      let seenApiKey = "";
      soulSwitch.registerWebTools({
        search: {
          defaultProvider: "gemini",
          providerApiKeys: {
            gemini: "gemini-key",
          },
          search: async ({ provider, providerApiKey }) => {
            seenProvider = provider ?? "";
            seenApiKey = providerApiKey ?? "";
            return [];
          },
        },
      });

      await soulSwitch.executeTool({
        name: "web_search",
        args: { query: "hello" },
        context: { agentId: "main" },
      });

      expect(seenProvider).toBe("gemini");
      expect(seenApiKey).toBe("gemini-key");
    } finally {
      if (typeof prevBrave === "string") {
        process.env.BRAVE_API_KEY = prevBrave;
      } else {
        delete process.env.BRAVE_API_KEY;
      }
    }
  });

  it("normalizes google redirect result URLs in web_search", async () => {
    const soulSwitch = createSoulSwitch({
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

    soulSwitch.registerWebTools({
      search: {
        search: async () => [
          {
            title: "Redirect",
            url: "https://www.google.com/url?q=https%3A%2F%2Fexample.org%2Farticle",
          },
        ],
      },
    });

    const result = await soulSwitch.executeTool({
      name: "web_search",
      args: { query: "citation" },
      context: { agentId: "main" },
    });

    const rows = (result.data as { results: Array<{ url: string }> }).results;
    expect(rows[0]?.url).toBe("https://example.org/article");
  });

  it("applies web tool defaults from config", async () => {
    const soulSwitch = createSoulSwitch({
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
        web: {
          search: {
            cacheTtlMs: 60_000,
          },
          fetch: {
            defaultMaxChars: 1234,
            maxCharsCap: 1234,
            timeoutMs: 3000,
            maxResponseBytes: 4096,
            maxRedirects: 1,
            userAgent: "SoulSwitchTest/1.0",
            cacheTtlMs: 60_000,
            allowPrivateNetwork: true,
          },
        },
      },
    });

    let seenMaxChars = 0;
    let seenUserAgent = "";
    soulSwitch.registerWebTools({
      search: {
        search: async () => [],
      },
      fetch: {
        fetchContent: async ({ maxChars, userAgent }) => {
          seenMaxChars = maxChars;
          seenUserAgent = userAgent;
          return { content: "ok" };
        },
      },
    });

    await soulSwitch.executeTool({
      name: "web_fetch",
      args: {
        url: "http://127.0.0.1/test",
      },
      context: { agentId: "main" },
    });

    expect(seenMaxChars).toBe(1234);
    expect(seenUserAgent).toBe("SoulSwitchTest/1.0");
  });

  it("marks default web_fetch extraction as truncated when limits are hit", async () => {
    const soulSwitch = createSoulSwitch({
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

    soulSwitch.registerWebTools({
      search: {
        search: async () => [],
      },
      fetch: {
        fetchContent: async () => ({ content: "x".repeat(3000), title: "Title" }),
        maxCharsCap: 50,
      },
    });

    const result = await soulSwitch.executeTool({
      name: "web_fetch",
      args: {
        url: "https://example.com",
        maxChars: 500,
      },
      context: { agentId: "main" },
    });

    expect(result.content.includes("[TRUNCATED]")).toBe(true);
  });

  it("uses web_fetch fallback when primary extraction is too short", async () => {
    const soulSwitch = createSoulSwitch({
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

    let fallbackCalls = 0;
    soulSwitch.registerWebTools({
      search: {
        search: async () => [],
      },
      fetch: {
        fetchContent: async () => ({ content: "short" }),
        firecrawlFallback: async () => {
          fallbackCalls += 1;
          return { content: "long fallback content" };
        },
      },
    });

    const result = await soulSwitch.executeTool({
      name: "web_fetch",
      args: {
        url: "https://example.com",
      },
      context: { agentId: "main" },
    });

    expect(fallbackCalls).toBe(1);
    expect(result.content).toContain("long fallback content");
    expect((result.data as { usedFallback?: boolean }).usedFallback).toBe(true);
  });

  it("registers media tools and executes image/pdf analysis", async () => {
    const soulSwitch = createSoulSwitch({
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

    soulSwitch.registerMediaTools({
      image: {
        analyze: async ({ input }) => ({ text: `image:${input}` }),
      },
      pdf: {
        analyze: async ({ input }) => ({ text: `pdf:${input}` }),
      },
    });

    const image = await soulSwitch.executeTool({
      name: "image",
      args: {
        image: "/tmp/a.png",
      },
      context: { agentId: "main" },
    });
    const pdf = await soulSwitch.executeTool({
      name: "pdf",
      args: {
        document: "/tmp/a.pdf",
      },
      context: { agentId: "main" },
    });

    expect(image.content).toBe("image:/tmp/a.png");
    expect(pdf.content).toBe("pdf:/tmp/a.pdf");
  });

  it("supports media model fallback attempts", async () => {
    const soulSwitch = createSoulSwitch({
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

    soulSwitch.registerMediaTools({
      image: {
        defaultModel: "broken/model",
        modelFallbacks: ["openai/gpt-4o-mini"],
        analyze: async ({ model }) => {
          if (model === "broken/model") {
            throw new Error("broken");
          }
          return { text: `ok:${model}` };
        },
      },
    });

    const image = await soulSwitch.executeTool({
      name: "image",
      args: { image: "a.png" },
      context: { agentId: "main" },
    });

    expect(image.content).toBe("ok:openai/gpt-4o-mini");
    const attempts = (image.data as { details?: { attempts?: Array<{ model?: string }> } }).details?.attempts ?? [];
    expect(attempts.some((entry) => entry.model === "broken/model")).toBe(true);
  });

  it("gates media tool registration when unavailable", () => {
    const soulSwitch = createSoulSwitch({
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

    soulSwitch.registerMediaTools({
      image: {
        enabled: false,
        analyze: async () => ({ text: "no" }),
      },
      pdf: {
        isAvailable: () => false,
        analyze: async () => ({ text: "no" }),
      },
    });

    expect(soulSwitch.hasTool("image")).toBe(false);
    expect(soulSwitch.hasTool("pdf")).toBe(false);
  });

  it("supports multi-input media args and caps item counts", async () => {
    const soulSwitch = createSoulSwitch({
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

    soulSwitch.registerMediaTools({
      image: {
        analyze: async ({ inputs }) => ({ text: `images:${(inputs ?? []).length}` }),
      },
      pdf: {
        analyze: async ({ inputs }) => ({ text: `pdfs:${(inputs ?? []).length}` }),
      },
    });

    const image = await soulSwitch.executeTool({
      name: "image",
      args: {
        images: ["a.png", "b.png", "a.png"],
      },
      context: { agentId: "main" },
    });
    const pdf = await soulSwitch.executeTool({
      name: "pdf",
      args: {
        pdfs: ["a.pdf", "b.pdf"],
      },
      context: { agentId: "main" },
    });

    expect(image.content).toBe("images:2");
    expect(pdf.content).toBe("pdfs:2");

    await expect(
      soulSwitch.executeTool({
        name: "pdf",
        args: {
          pdfs: Array.from({ length: 11 }, (_, i) => `f${i}.pdf`),
        },
        context: { agentId: "main" },
      }),
    ).rejects.toMatchObject({ code: "TOOL_FAILED" });

    const pagesResult = await soulSwitch.executeTool({
      name: "pdf",
      args: {
        pdf: "https://example.com/doc.pdf",
        pages: "3,1-2,2",
        model: "openai/gpt-4o-mini",
      },
      context: { agentId: "main" },
    });
    expect((pagesResult.data as { pages?: string }).pages).toBe("1,2,3");
    expect((pagesResult.data as { native?: boolean }).native).toBe(false);

    await expect(
      soulSwitch.executeTool({
        name: "pdf",
        args: {
          pdf: "ftp://example.com/doc.pdf",
        },
        context: { agentId: "main" },
      }),
    ).rejects.toMatchObject({ code: "TOOL_FAILED", details: { error: "unsupported_pdf_reference" } });

    await expect(
      soulSwitch.executeTool({
        name: "pdf",
        args: {
          pdf: "https://example.com/doc.pdf",
          pages: "1-two",
        },
        context: { agentId: "main" },
      }),
    ).rejects.toMatchObject({ code: "TOOL_FAILED" });

    await expect(
      soulSwitch.executeTool({
        name: "pdf",
        args: {
          pdf: "https://example.com/doc.pdf",
          model: "anthropic/claude-opus-4-6",
          pages: "1-2",
        },
        context: { agentId: "main" },
      }),
    ).rejects.toMatchObject({ code: "TOOL_FAILED" });
  });

  it("registers browser and canvas tools and routes actions", async () => {
    const soulSwitch = createSoulSwitch({
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

    const browserActions: string[] = [];
    const browserStatusArgs: Record<string, unknown>[] = [];
    const browserActArgs: Record<string, unknown>[] = [];
    const browserOpenArgs: Record<string, unknown>[] = [];
    const browserFocusArgs: Record<string, unknown>[] = [];
    let browserNavigateArgs: Record<string, unknown> | undefined;
    const browserCloseArgs: Record<string, unknown>[] = [];
    let browserDialogArgs: Record<string, unknown> | undefined;
    let browserUploadArgs: Record<string, unknown> | undefined;
    const canvasActions: string[] = [];
    let canvasPresentArgs: Record<string, unknown> | undefined;
    let canvasNavigateArgs: Record<string, unknown> | undefined;
    let canvasA2uiArgs: Record<string, unknown> | undefined;
    const canvasSnapshotArgs: Record<string, unknown>[] = [];
    soulSwitch.registerBrowserTools({
      execute: async ({ action, args }) => {
        browserActions.push(action);
        if (action === "act") {
          browserActArgs.push(args);
        }
        if (action === "status") {
          browserStatusArgs.push(args);
        }
        if (action === "open") {
          browserOpenArgs.push(args);
        }
        if (action === "focus") {
          browserFocusArgs.push(args);
        }
        if (action === "navigate") {
          browserNavigateArgs = args;
        }
        if (action === "close") {
          browserCloseArgs.push(args);
        }
        if (action === "dialog") {
          browserDialogArgs = args;
        }
        if (action === "upload") {
          browserUploadArgs = args;
        }
        return {
          content: `browser:${action}`,
        };
      },
    });
    soulSwitch.registerCanvasTools({
      execute: async ({ action, args }) => {
        canvasActions.push(action);
        if (action === "present") {
          canvasPresentArgs = args;
        }
        if (action === "navigate") {
          canvasNavigateArgs = args;
        }
        if (action === "a2ui_push") {
          canvasA2uiArgs = args;
        }
        if (action === "snapshot") {
          canvasSnapshotArgs.push(args);
        }
        return {
          content: `canvas:${action}`,
        };
      },
    });

    const browser = await soulSwitch.executeTool({
      name: "browser",
      args: { action: "snapshot" },
      context: { agentId: "main" },
    });
    const canvas = await soulSwitch.executeTool({
      name: "canvas",
      args: { action: "present", target: "https://example.com" },
      context: { agentId: "main" },
    });
    const browserTrace = await soulSwitch.executeTool({
      name: "browser",
      args: { action: "trace.start", profile: "openclaw", target: "host" },
      context: { agentId: "main" },
    });
    const browserChromeStatus = await soulSwitch.executeTool({
      name: "browser",
      args: { action: "status", profile: "chrome" },
      context: { agentId: "main" },
    });
    const browserChromeStatusBlankTarget = await soulSwitch.executeTool({
      name: "browser",
      args: { action: "status", profile: "chrome", target: "   " },
      context: { agentId: "main" },
    });
    const browserNodeStatus = await soulSwitch.executeTool({
      name: "browser",
      args: { action: "status", node: "edge-1" },
      context: { agentId: "main" },
    });
    const browserAct = await soulSwitch.executeTool({
      name: "browser",
      args: { action: "act", request: { kind: "click", ref: "button.submit" } },
      context: { agentId: "main" },
    });
    const browserActLegacy = await soulSwitch.executeTool({
      name: "browser",
      args: { action: "act", kind: "press", key: "Enter" },
      context: { agentId: "main" },
    });
    const browserActSnake = await soulSwitch.executeTool({
      name: "browser",
      args: { action: "act", request: { kind: "press", key: "Escape", delay_ms: 5 } },
      context: { agentId: "main" },
    });
    const browserActScrollAlias = await soulSwitch.executeTool({
      name: "browser",
      args: { action: "act", request: { kind: "scrollintoview", ref: "button.cta" } },
      context: { agentId: "main" },
    });
    const browserDialog = await soulSwitch.executeTool({
      name: "browser",
      args: { action: "dialog" },
      context: { agentId: "main" },
    });
    const browserDialogSnake = await soulSwitch.executeTool({
      name: "browser",
      args: { action: "dialog", prompt_text: "otp" },
      context: { agentId: "main" },
    });
    const browserOpenAlias = await soulSwitch.executeTool({
      name: "browser",
      args: { action: "open", targetUrl: "https://example.com/alias" },
      context: { agentId: "main" },
    });
    const browserOpenSnakeAlias = await soulSwitch.executeTool({
      name: "browser",
      args: { action: "open", target_url: "https://example.com/snake" },
      context: { agentId: "main" },
    });
    const browserFocusAlias = await soulSwitch.executeTool({
      name: "browser",
      args: { action: "focus", tabId: "tab-9" },
      context: { agentId: "main" },
    });
    const browserFocusSnakeAlias = await soulSwitch.executeTool({
      name: "browser",
      args: { action: "focus", tab_id: "tab-10" },
      context: { agentId: "main" },
    });
    const browserNavigateAlias = await soulSwitch.executeTool({
      name: "browser",
      args: { action: "navigate", targetUrl: "https://example.com/nav" },
      context: { agentId: "main" },
    });
    const browserCloseAlias = await soulSwitch.executeTool({
      name: "browser",
      args: { action: "close", tabId: "tab-8" },
      context: { agentId: "main" },
    });
    const browserCloseDefault = await soulSwitch.executeTool({
      name: "browser",
      args: { action: "close" },
      context: { agentId: "main" },
    });
    const browserUpload = await soulSwitch.executeTool({
      name: "browser",
      args: { action: "upload", paths: ["/tmp/a.txt", 42] },
      context: { agentId: "main" },
    });
    const browserCookies = await soulSwitch.executeTool({
      name: "browser",
      args: { action: "cookies.set" },
      context: { agentId: "main" },
    });
    const canvasA2ui = await soulSwitch.executeTool({
      name: "canvas",
      args: { action: "a2ui.pushJSONL", jsonl: "{}" },
      context: { agentId: "main" },
    });
    const canvasA2uiPath = await soulSwitch.executeTool({
      name: "canvas",
      args: { action: "a2ui.pushJSONL", jsonlPath: "./a2ui.jsonl" },
      context: { agentId: "main" },
    });
    const canvasNavigateAlias = await soulSwitch.executeTool({
      name: "canvas",
      args: { action: "navigate", target: "https://example.com/canvas" },
      context: { agentId: "main" },
    });
    const canvasPresentAlias = await soulSwitch.executeTool({
      name: "canvas",
      args: { action: "present", url: "https://example.com/embed" },
      context: { agentId: "main" },
    });
    const canvasSnapshot = await soulSwitch.executeTool({
      name: "canvas",
      args: { action: "snapshot", node: "canvas-node-1", target_mode: "node" },
      context: { agentId: "main" },
    });
    const canvasSnapshotSnakeFormat = await soulSwitch.executeTool({
      name: "canvas",
      args: { action: "snapshot", output_format: "jpg" },
      context: { agentId: "main" },
    });

    expect(browser.content).toBe("browser:snapshot");
    expect(canvas.content).toBe("canvas:present");
    expect(browserTrace.content).toBe("browser:trace_start");
    expect(browserChromeStatus.content).toBe("browser:status");
    expect(browserChromeStatusBlankTarget.content).toBe("browser:status");
    expect(browserNodeStatus.content).toBe("browser:status");
    expect(browserAct.content).toBe("browser:act");
    expect(browserActLegacy.content).toBe("browser:act");
    expect(browserActSnake.content).toBe("browser:act");
    expect(browserActScrollAlias.content).toBe("browser:act");
    expect(browserDialog.content).toBe("browser:dialog");
    expect(browserDialogSnake.content).toBe("browser:dialog");
    expect(browserOpenAlias.content).toBe("browser:open");
    expect(browserOpenSnakeAlias.content).toBe("browser:open");
    expect(browserFocusAlias.content).toBe("browser:focus");
    expect(browserFocusSnakeAlias.content).toBe("browser:focus");
    expect(browserNavigateAlias.content).toBe("browser:navigate");
    expect(browserCloseAlias.content).toBe("browser:close");
    expect(browserCloseDefault.content).toBe("browser:close");
    expect(browserUpload.content).toBe("browser:upload");
    expect((browserTrace.data as { profile?: string }).profile).toBe("openclaw");
    expect((browserTrace.data as { target?: string }).target).toBe("host");
    expect((browserChromeStatus.data as { target?: string }).target).toBe("host");
    expect((browserChromeStatusBlankTarget.data as { target?: string }).target).toBe("host");
    expect((browserNodeStatus.data as { node?: string }).node).toBe("edge-1");
    expect((browserNodeStatus.data as { target?: string }).target).toBe("node");
    expect((browserStatusArgs[0] as { target?: string } | undefined)?.target).toBe("host");
    expect((browserStatusArgs[1] as { target?: string } | undefined)?.target).toBe("host");
    expect((browserStatusArgs[2] as { target?: string } | undefined)?.target).toBe("node");
    expect((browserTrace.data as { details?: { action?: string } }).details?.action).toBe("trace_start");
    expect(
      (browser.data as { details?: { externalContent?: { source?: string; kind?: string } } }).details
        ?.externalContent?.source,
    ).toBe("browser");
    expect(
      (browser.data as { details?: { externalContent?: { source?: string; kind?: string } } }).details
        ?.externalContent?.kind,
    ).toBe("snapshot");
    expect((browserActArgs[0]?.request as { kind?: string })?.kind).toBe("click");
    expect((browserActArgs[0] as { kind?: string } | undefined)?.kind).toBe("click");
    expect((browserActArgs[1]?.request as { kind?: string; key?: string })?.kind).toBe("press");
    expect((browserActArgs[1]?.request as { kind?: string; key?: string })?.key).toBe("Enter");
    expect((browserActArgs[2]?.request as { kind?: string; key?: string; delayMs?: number })?.key).toBe("Escape");
    expect((browserActArgs[2]?.request as { kind?: string; key?: string; delayMs?: number })?.delayMs).toBe(5);
    expect((browserActArgs[3]?.request as { kind?: string; ref?: string })?.kind).toBe("scrollIntoView");
    expect((browserActArgs[3]?.request as { kind?: string; ref?: string })?.ref).toBe("button.cta");
    expect((browserOpenArgs[0] as { url?: string } | undefined)?.url).toBe("https://example.com/alias");
    expect((browserOpenArgs[1] as { url?: string } | undefined)?.url).toBe("https://example.com/snake");
    expect((browserFocusArgs[0] as { targetId?: string } | undefined)?.targetId).toBe("tab-9");
    expect((browserFocusArgs[1] as { targetId?: string } | undefined)?.targetId).toBe("tab-10");
    expect((browserNavigateArgs as { url?: string } | undefined)?.url).toBe("https://example.com/nav");
    expect((browserCloseArgs[0] as { targetId?: string } | undefined)?.targetId).toBe("tab-8");
    expect((browserCloseArgs[1] as { targetId?: string } | undefined)?.targetId).toBeUndefined();
    expect((browserDialogArgs as { accept?: boolean } | undefined)?.accept).toBe(false);
    expect((browserDialogArgs as { promptText?: string } | undefined)?.promptText).toBe("otp");
    expect((browserUploadArgs as { paths?: string[] } | undefined)?.paths).toEqual(["/tmp/a.txt", "42"]);
    expect(browserCookies.content).toBe("browser:cookies_set");
    expect(canvasA2ui.content).toBe("canvas:a2ui_push");
    expect(canvasA2uiPath.content).toBe("canvas:a2ui_push");
    expect(canvasNavigateAlias.content).toBe("canvas:navigate");
    expect(canvasPresentAlias.content).toBe("canvas:present");
    expect(canvasSnapshot.content).toBe("canvas:snapshot");
    expect(canvasSnapshotSnakeFormat.content).toBe("canvas:snapshot");
    expect((canvasSnapshot.data as { node?: string }).node).toBe("canvas-node-1");
    expect((canvasSnapshot.data as { target?: string }).target).toBe("node");
    expect((canvasSnapshotArgs[0] as { executionTarget?: string } | undefined)?.executionTarget).toBe("node");
    expect((canvasNavigateArgs as { url?: string } | undefined)?.url).toBe("https://example.com/canvas");
    expect((canvasPresentArgs as { target?: string } | undefined)?.target).toBe("https://example.com/embed");
    expect((canvasA2uiArgs as { jsonl?: string } | undefined)?.jsonl).toBe("./a2ui.jsonl");
    expect((canvasA2ui.data as { details?: { action?: string } }).details?.action).toBe("a2ui_push");
    expect(browserActions).toContain("trace_start");
    expect(browserActions).toContain("dialog");
    expect(browserActions).toContain("cookies_set");
    expect(canvasActions).toContain("a2ui_push");
  });

  it("validates browser and canvas actions", async () => {
    const soulSwitch = createSoulSwitch({
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
    soulSwitch.registerBrowserTools({ execute: async () => ({ content: "ok" }) });
    soulSwitch.registerCanvasTools({ execute: async () => ({ content: "ok" }) });

    await expect(
      soulSwitch.executeTool({
        name: "browser",
        args: { action: "unknown" },
        context: { agentId: "main" },
      }),
    ).rejects.toMatchObject({ code: "TOOL_FAILED" });
    await expect(
      soulSwitch.executeTool({
        name: "canvas",
        args: { action: "unknown" },
        context: { agentId: "main" },
      }),
    ).rejects.toMatchObject({ code: "TOOL_FAILED" });

    await expect(
      soulSwitch.executeTool({
        name: "browser",
        args: { action: "open" },
        context: { agentId: "main" },
      }),
    ).rejects.toMatchObject({ code: "TOOL_FAILED" });
    await expect(
      soulSwitch.executeTool({
        name: "browser",
        args: { action: "focus" },
        context: { agentId: "main" },
      }),
    ).rejects.toMatchObject({ code: "TOOL_FAILED" });
    await expect(
      soulSwitch.executeTool({
        name: "browser",
        args: { action: "act", request: {} },
        context: { agentId: "main" },
      }),
    ).rejects.toMatchObject({ code: "TOOL_FAILED" });
    await expect(
      soulSwitch.executeTool({
        name: "browser",
        args: { action: "act", request: { kind: "noop" } },
        context: { agentId: "main" },
      }),
    ).rejects.toMatchObject({ code: "TOOL_FAILED" });
    await expect(
      soulSwitch.executeTool({
        name: "browser",
        args: { action: "act", request: { kind: "type", ref: "input.email" } },
        context: { agentId: "main" },
      }),
    ).rejects.toMatchObject({ code: "TOOL_FAILED" });
    await expect(
      soulSwitch.executeTool({
        name: "browser",
        args: { action: "act", request: { kind: "select", ref: "select#plan" } },
        context: { agentId: "main" },
      }),
    ).rejects.toMatchObject({ code: "TOOL_FAILED" });
    await expect(
      soulSwitch.executeTool({
        name: "browser",
        args: { action: "act", request: { kind: "fill", fields: [] } },
        context: { agentId: "main" },
      }),
    ).rejects.toMatchObject({ code: "TOOL_FAILED" });
    await expect(
      soulSwitch.executeTool({
        name: "browser",
        args: { action: "act", request: { kind: "wait", loadState: "idle" } },
        context: { agentId: "main" },
      }),
    ).rejects.toMatchObject({ code: "TOOL_FAILED" });
    await expect(
      soulSwitch.executeTool({
        name: "browser",
        args: { action: "dialog", accept: "yes" },
        context: { agentId: "main" },
      }),
    ).rejects.toMatchObject({ code: "TOOL_FAILED" });
    await expect(
      soulSwitch.executeTool({
        name: "browser",
        args: { action: "set.viewport", width: 100 },
        context: { agentId: "main" },
      }),
    ).rejects.toMatchObject({ code: "TOOL_FAILED" });
    await expect(
      soulSwitch.executeTool({
        name: "browser",
        args: { action: "upload" },
        context: { agentId: "main" },
      }),
    ).rejects.toMatchObject({ code: "TOOL_FAILED" });
    await expect(
      soulSwitch.executeTool({
        name: "browser",
        args: { action: "upload", paths: ["   "] },
        context: { agentId: "main" },
      }),
    ).rejects.toMatchObject({ code: "TOOL_FAILED" });
    await expect(
      soulSwitch.executeTool({
        name: "browser",
        args: { action: "screenshot", type: "webp" },
        context: { agentId: "main" },
      }),
    ).rejects.toMatchObject({ code: "TOOL_FAILED" });
    await expect(
      soulSwitch.executeTool({
        name: "browser",
        args: { action: "snapshot", snapshotFormat: "xml" },
        context: { agentId: "main" },
      }),
    ).rejects.toMatchObject({ code: "TOOL_FAILED" });
    await expect(
      soulSwitch.executeTool({
        name: "browser",
        args: { action: "snapshot", mode: "full" },
        context: { agentId: "main" },
      }),
    ).rejects.toMatchObject({ code: "TOOL_FAILED" });
    await expect(
      soulSwitch.executeTool({
        name: "browser",
        args: { action: "snapshot", refs: "css" },
        context: { agentId: "main" },
      }),
    ).rejects.toMatchObject({ code: "TOOL_FAILED" });
    await expect(
      soulSwitch.executeTool({
        name: "canvas",
        args: { action: "present" },
        context: { agentId: "main" },
      }),
    ).rejects.toMatchObject({ code: "TOOL_FAILED" });
    await expect(
      soulSwitch.executeTool({
        name: "canvas",
        args: { action: "eval" },
        context: { agentId: "main" },
      }),
    ).rejects.toMatchObject({ code: "TOOL_FAILED" });
    await expect(
      soulSwitch.executeTool({
        name: "canvas",
        args: { action: "snapshot", outputFormat: "webp" },
        context: { agentId: "main" },
      }),
    ).rejects.toMatchObject({ code: "TOOL_FAILED" });
    await expect(
      soulSwitch.executeTool({
        name: "browser",
        args: { action: "status", target: "cloud" },
        context: { agentId: "main" },
      }),
    ).rejects.toMatchObject({ code: "TOOL_FAILED" });
    await expect(
      soulSwitch.executeTool({
        name: "browser",
        args: { action: "status", target: "host", node: "edge-1" },
        context: { agentId: "main" },
      }),
    ).rejects.toMatchObject({ code: "TOOL_FAILED" });
    await expect(
      soulSwitch.executeTool({
        name: "canvas",
        args: { action: "present", target: "https://example.com", targetMode: "cloud" },
        context: { agentId: "main" },
      }),
    ).rejects.toMatchObject({ code: "TOOL_FAILED" });
  });

  it("registers llm_task tool and parses JSON output", async () => {
    const soulSwitch = createSoulSwitch({
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
    soulSwitch.registerModelProvider({
      id: "openai",
      async generate(request) {
        return {
          text: JSON.stringify({ ok: true, prompt: request.prompt }),
          providerId: request.providerId,
          modelId: request.modelId,
        };
      },
    });
    soulSwitch.registerLlmTaskTool();
    expect(soulSwitch.hasTool("llm_task")).toBe(true);
    expect(soulSwitch.hasTool("llm-task")).toBe(true);

    const result = await soulSwitch.executeTool({
      name: "llm_task",
      args: {
        prompt: "Return JSON",
      },
      context: { agentId: "main" },
    });

    expect(result.content).toContain('"ok": true');
    expect((result.data as { json?: { ok?: boolean } }).json?.ok).toBe(true);
    expect((result.data as { providerId?: string }).providerId).toBe("openai");
    expect((result.data as { modelId?: string }).modelId).toBe("gpt-4o-mini");
    expect((result.data as { details?: { json?: { ok?: boolean } } }).details?.json?.ok).toBe(true);

    const aliasResult = await soulSwitch.executeTool({
      name: "llm-task",
      args: {
        prompt: "Return JSON",
      },
      context: { agentId: "main" },
    });
    expect(aliasResult.content).toContain('"ok": true');
  });

  it("accepts fenced JSON response in llm_task", async () => {
    const soulSwitch = createSoulSwitch({
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
    soulSwitch.registerModelProvider({
      id: "openai",
      async generate(request) {
        return {
          text: `\`\`\`json\n${JSON.stringify({ ok: true, prompt: request.prompt })}\n\`\`\``,
          providerId: request.providerId,
          modelId: request.modelId,
        };
      },
    });
    soulSwitch.registerLlmTaskTool();

    const result = await soulSwitch.executeTool({
      name: "llm_task",
      args: {
        prompt: "Return JSON",
        input: { hello: "world" },
      },
      context: { agentId: "main" },
    });

    expect(result.content).toContain('"ok": true');
  });

  it("supports provider/model aliases in llm_task args", async () => {
    const soulSwitch = createSoulSwitch({
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
    soulSwitch.registerModelProvider({
      id: "openai",
      async generate(request) {
        return {
          text: JSON.stringify({ provider: request.providerId, model: request.modelId }),
          providerId: request.providerId,
          modelId: request.modelId,
        };
      },
    });
    soulSwitch.registerLlmTaskTool();

    const result = await soulSwitch.executeTool({
      name: "llm_task",
      args: {
        prompt: "Return JSON",
        provider: "openai",
        model: "gpt-4o-mini",
      },
      context: { agentId: "main" },
    });

    expect(result.content).toContain('"provider": "openai"');
    expect(result.content).toContain('"model": "gpt-4o-mini"');
  });

  it("validates llm_task output with JSON schema when provided", async () => {
    const soulSwitch = createSoulSwitch({
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
    soulSwitch.registerModelProvider({
      id: "openai",
      async generate(request) {
        return {
          text: JSON.stringify({ answer: request.prompt }),
          providerId: request.providerId,
          modelId: request.modelId,
        };
      },
    });
    soulSwitch.registerLlmTaskTool();

    const ok = await soulSwitch.executeTool({
      name: "llm_task",
      args: {
        prompt: "hello",
        schema: {
          type: "object",
          required: ["answer"],
          additionalProperties: false,
          properties: {
            answer: { type: "string" },
          },
        },
      },
      context: { agentId: "main" },
    });
    expect(ok.content).toContain('"answer":');

    await expect(
      soulSwitch.executeTool({
        name: "llm_task",
        args: {
          prompt: "hello",
          schema: {
            type: "object",
            required: ["missing"],
            properties: {
              missing: { type: "string" },
            },
          },
        },
        context: { agentId: "main" },
      }),
    ).rejects.toMatchObject({ code: "TOOL_FAILED" });

    await expect(
      soulSwitch.executeTool({
        name: "llm_task",
        args: {
          prompt: "hello",
          schema: "not-an-object",
        },
        context: { agentId: "main" },
      }),
    ).rejects.toMatchObject({ code: "TOOL_FAILED" });
  });

  it("fails llm_task when model output is invalid JSON", async () => {
    const soulSwitch = createSoulSwitch({
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
    soulSwitch.registerModelProvider({
      id: "openai",
      async generate(request) {
        return {
          text: `not-json:${request.prompt}`,
          providerId: request.providerId,
          modelId: request.modelId,
        };
      },
    });
    soulSwitch.registerLlmTaskTool();

    await expect(
      soulSwitch.executeTool({
        name: "llm_task",
        args: {
          prompt: "Return JSON",
        },
        context: { agentId: "main" },
      }),
    ).rejects.toMatchObject({ code: "TOOL_FAILED" });
  });

  it("fails llm_task when JSON validation fails", async () => {
    const soulSwitch = createSoulSwitch({
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
    soulSwitch.registerModelProvider({
      id: "openai",
      async generate(request) {
        return {
          text: JSON.stringify({ mode: "unsafe", prompt: request.prompt }),
          providerId: request.providerId,
          modelId: request.modelId,
        };
      },
    });
    soulSwitch.registerLlmTaskTool({
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
      soulSwitch.executeTool({
        name: "llm_task",
        args: {
          prompt: "Return JSON",
        },
        context: { agentId: "main" },
      }),
    ).rejects.toMatchObject({ code: "TOOL_FAILED" });
  });

  it("enforces llm_task allowed model list", async () => {
    const soulSwitch = createSoulSwitch({
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
    soulSwitch.registerModelProvider({
      id: "openai",
      async generate(request) {
        return {
          text: JSON.stringify({ ok: true, prompt: request.prompt }),
          providerId: request.providerId,
          modelId: request.modelId,
        };
      },
    });
    soulSwitch.registerLlmTaskTool({
      allowedModels: ["openai/gpt-4o"],
    });

    await expect(
      soulSwitch.executeTool({
        name: "llm_task",
        args: {
          prompt: "Return JSON",
        },
        context: { agentId: "main" },
      }),
    ).rejects.toMatchObject({ code: "TOOL_NOT_ALLOWED" });
  });

  it("registers session tools and orchestrates sessions", async () => {
    const soulSwitch = createSoulSwitch({
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

    soulSwitch.registerAgent({ id: "main", model: { providerId: "openai", modelId: "gpt-4o-mini" } });
    soulSwitch.registerModelProvider({
      id: "openai",
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
    const send = await soulSwitch.executeTool({
      name: "sessions_send",
      args: {
        sessionId: "main",
        message: "ping",
      },
      context: { agentId: "main", sessionId: "main" },
    });
    const spawn = await soulSwitch.executeTool({
      name: "sessions_spawn",
      args: {
        task: "sub task",
      },
      context: { agentId: "main", sessionId: "main" },
    });
    const history = await soulSwitch.executeTool({
      name: "sessions_history",
      args: {
        sessionKey: "main",
      },
      context: { agentId: "main", sessionId: "main" },
    });
    const status = await soulSwitch.executeTool({
      name: "session_status",
      args: {
        sessionId: "main",
      },
      context: { agentId: "main", sessionId: "main" },
    });
    const statusAlias = await soulSwitch.executeTool({
      name: "session_status",
      args: {
        sessionKey: "main",
      },
      context: { agentId: "main", sessionId: "main" },
    });
    const statusOverride = await soulSwitch.executeTool({
      name: "session_status",
      args: {
        sessionId: "main",
        model: "gpt-4o",
      },
      context: { agentId: "main", sessionId: "main" },
    });

    expect(list.content).toContain("main");
    expect(send.content).toContain("echo:ping");
    expect(spawn.content).toContain("echo:sub task");
    expect(history.content).toContain("user: hello");
    expect(status.content).toContain("main [main]");
    expect(statusAlias.content).toContain("main [main]");
    expect((status.data as { details?: { sessionId?: string } }).details?.sessionId).toBe("main");
    expect((statusOverride.data as { changedModel?: boolean }).changedModel).toBe(true);

    const sendAlias = await soulSwitch.executeTool({
      name: "sessions_send",
      args: {
        sessionKey: "main",
        text: "ping-2",
      },
      context: { agentId: "main", sessionId: "main" },
    });
    const sendAccepted = await soulSwitch.executeTool({
      name: "sessions_send",
      args: {
        sessionKey: "main",
        text: "ping-async",
        timeoutSeconds: 0,
      },
      context: { agentId: "main", sessionId: "main" },
    });
    await soulSwitch.executeTool({
      name: "session_status",
      args: {
        sessionId: "main",
        model: "default",
      },
      context: { agentId: "main", sessionId: "main" },
    });
    const sendAfterReset = await soulSwitch.executeTool({
      name: "sessions_send",
      args: {
        sessionKey: "main",
        text: "ping-after-reset",
      },
      context: { agentId: "main", sessionId: "main" },
    });
    const spawnAlias = await soulSwitch.executeTool({
      name: "sessions_spawn",
      args: {
        prompt: "sub task alias",
        runtime: "acp",
        label: "worker-alpha",
        mode: "session",
      },
      context: { agentId: "main", sessionId: "main" },
    });

    expect(sendAlias.content).toContain("echo:ping-2");
    expect((sendAlias.data as { modelId?: string }).modelId).toBe("gpt-4o");
    expect((sendAccepted.data as { status?: string }).status).toBe("accepted");
    expect((sendAfterReset.data as { modelId?: string }).modelId).toBe("gpt-4o-mini");
    expect(spawnAlias.content).toContain("echo:sub task alias");
    expect((sendAlias.data as { details?: { sessionId?: string } }).details?.sessionId).toBe("main");
    expect((spawnAlias.data as { details?: { sessionId?: string } }).details?.sessionId).toContain("agent:main:acp:");

    const spawnedStatus = await soulSwitch.executeTool({
      name: "session_status",
      args: {
        sessionId: (spawnAlias.data as { sessionId: string }).sessionId,
      },
      context: { agentId: "main", sessionId: "main" },
    });
    expect(spawnedStatus.content).toContain("agent:main:acp:");
  });

  it("lists registered plugins", async () => {
    const soulSwitch = createSoulSwitch({
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

    await soulSwitch.registerPlugin({
      id: "hooks-one",
      capabilities: ["hooks"],
      setup(api) {
        api.on("beforeRun", () => undefined);
        api.on("beforePersonaLoad", (snapshot) => snapshot);
      },
    });

    expect(soulSwitch.hasPlugin("hooks-one")).toBe(true);
    expect(soulSwitch.listPlugins()).toContain("hooks-one");
  });

  it("returns plugin summaries", async () => {
    const soulSwitch = createSoulSwitch({
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

    await soulSwitch.registerPlugin({
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

    const summaries = soulSwitch.listPluginSummaries();
    const summary = soulSwitch.getPluginSummary("summary-plugin");

    expect(summaries.some((entry) => entry.id === "summary-plugin")).toBe(true);
    expect(summary?.toolCount).toBe(1);
    expect(summary?.providerCount).toBe(1);
    expect(summary?.apiVersion).toBe(1);
    expect(summary?.capabilities).toContain("hooks");
    expect(summary?.hooks).toContain("beforeRun");
    expect(summary?.hooks).toContain("beforePersonaLoad");
  });

  it("unregisters plugins and cleans plugin-owned resources", async () => {
    const soulSwitch = createSoulSwitch({
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

    await soulSwitch.registerPlugin({
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

    expect(soulSwitch.hasPlugin("plugin-resources")).toBe(true);
    expect(soulSwitch.hasTool("plugin-tool")).toBe(true);
    expect(soulSwitch.hasModelProvider("plugin-provider")).toBe(true);

    const removed = await soulSwitch.removePlugin("plugin-resources");
    expect(removed).toBe(true);
    expect(soulSwitch.hasPlugin("plugin-resources")).toBe(false);
    expect(soulSwitch.hasTool("plugin-tool")).toBe(false);
    expect(soulSwitch.hasModelProvider("plugin-provider")).toBe(false);
  });

  it("stops plugin hooks after plugin unload and emits unregistered event", async () => {
    const soulSwitch = createSoulSwitch({
      providers: {
        openaiCompatible: [],
      },
    });

    soulSwitch.registerAgent({
      id: "main",
      model: { providerId: "provider", modelId: "model" },
    });
    soulSwitch.registerModelProvider({
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
    soulSwitch.onEvent((event) => {
      if (event.type === "plugin.unregistered") {
        unregistered.push(event.data.pluginId);
      }
    });

    await soulSwitch.registerPlugin({
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

    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "soulSwitch-plugin-hook-stop-"));
    try {
      await fs.writeFile(path.join(workspace, "SOUL.md"), "soul", "utf8");

      await soulSwitch.run({ agentId: "main", prompt: "one", workspaceDir: workspace });
      expect(beforeRunCalls).toBe(1);
      expect(beforePersonaLoadCalls).toBe(1);

      expect(await soulSwitch.removePlugin("ephemeral")).toBe(true);
      expect(unregistered).toContain("ephemeral");

      await soulSwitch.run({ agentId: "main", prompt: "two", workspaceDir: workspace });
      expect(beforeRunCalls).toBe(1);
      expect(beforePersonaLoadCalls).toBe(1);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it("runs plugin teardown during unload", async () => {
    const soulSwitch = createSoulSwitch({
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
    await soulSwitch.registerPlugin({
      id: "cleanup-plugin",
      capabilities: ["hooks"],
      setup(api) {
        api.on("beforeRun", () => undefined);
        return () => {
          teardownCalls += 1;
        };
      },
    });

    expect(await soulSwitch.removePlugin("cleanup-plugin")).toBe(true);
    expect(teardownCalls).toBe(1);
  });

  it("surfaces plugin teardown failures while still unloading plugin resources", async () => {
    const soulSwitch = createSoulSwitch({
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

    await soulSwitch.registerPlugin({
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

    await expect(soulSwitch.removePlugin("broken-cleanup")).rejects.toMatchObject({
      code: "PLUGIN_UNLOAD_FAILED",
    });
    expect(soulSwitch.hasPlugin("broken-cleanup")).toBe(false);
    expect(soulSwitch.hasTool("broken-tool")).toBe(false);
  });

  it("manages model provider lifecycle", () => {
    const soulSwitch = createSoulSwitch({
      providers: {
        openaiCompatible: [],
      },
    });

    soulSwitch.registerModelProvider({
      id: "provider-a",
      async generate(request) {
        return {
          text: "ok",
          providerId: request.providerId,
          modelId: request.modelId,
        };
      },
    });

    expect(soulSwitch.hasModelProvider("provider-a")).toBe(true);
    expect(soulSwitch.listModelProviders().map((provider) => provider.id)).toContain("provider-a");
    expect(soulSwitch.removeModelProvider("provider-a")).toBe(true);
    expect(soulSwitch.hasModelProvider("provider-a")).toBe(false);
  });

  it("manages auth profile lifecycle", () => {
    const soulSwitch = createSoulSwitch({
      providers: {
        openaiCompatible: [],
      },
    });

    soulSwitch.registerAuthProfile({
      id: "work",
      apiKey: "abc",
      headers: { "x-org": "team-a" },
    });

    expect(soulSwitch.hasAuthProfile("work")).toBe(true);
    expect(soulSwitch.listAuthProfiles().some((profile) => profile.id === "work")).toBe(true);
    expect(soulSwitch.removeAuthProfile("work")).toBe(true);
    expect(soulSwitch.hasAuthProfile("work")).toBe(false);
  });

  it("blocks plugin operations outside declared capabilities", async () => {
    const soulSwitch = createSoulSwitch({
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
      soulSwitch.registerPlugin({
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
    const soulSwitch = createSoulSwitch({
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
      soulSwitch.registerPlugin({
        id: "future-plugin",
        apiVersion: 99,
        setup() {
          return undefined;
        },
      }),
    ).rejects.toMatchObject({ code: "PLUGIN_API_VERSION_UNSUPPORTED" });
  });

  it("emits plugin registration events", async () => {
    const soulSwitch = createSoulSwitch({
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
    soulSwitch.onEvent((event) => {
      events.push(event.type);
    });

    await soulSwitch.registerPlugin({
      id: "hooker",
      capabilities: ["hooks"],
      setup(api) {
        api.on("beforeRun", () => undefined);
      },
    });

    expect(events).toContain("plugin.registered");
  });

  it("supports event listener unsubscribe", async () => {
    const soulSwitch = createSoulSwitch({
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
    const unsubscribe = soulSwitch.onEvent((event) => {
      events.push(event.type);
    });

    await soulSwitch.registerPlugin({
      id: "hooker",
      capabilities: ["hooks"],
      setup(api) {
        api.on("beforeRun", () => undefined);
      },
    });
    expect(events).toContain("plugin.registered");

    const before = events.length;
    unsubscribe();

    await soulSwitch.registerPlugin({
      id: "hooker-2",
      capabilities: ["hooks"],
      setup(api) {
        api.on("beforeRun", () => undefined);
      },
    });

    expect(events.length).toBe(before);
  });

  it("uses fallback model attempts when primary provider fails", async () => {
    const soulSwitch = createSoulSwitch({
      providers: {
        openaiCompatible: [],
      },
    });

    soulSwitch.registerAgent({
      id: "main",
      model: {
        providerId: "primary",
        modelId: "one",
        fallbacks: [{ providerId: "secondary", modelId: "two" }],
      },
    });

    soulSwitch.registerModelProvider({
      id: "primary",
      async generate() {
        throw new Error("primary down");
      },
    });

    soulSwitch.registerModelProvider({
      id: "secondary",
      async generate(request) {
        return {
          text: "fallback ok",
          providerId: request.providerId,
          modelId: request.modelId,
        };
      },
    });

    const result = await soulSwitch.run({ agentId: "main", prompt: "hello" });

    expect(result.text).toBe("fallback ok");
    expect(result.providerId).toBe("secondary");
    expect(result.modelId).toBe("two");
  });

  it("emits run started/completed events", async () => {
    const soulSwitch = createSoulSwitch({
      providers: {
        openaiCompatible: [],
      },
    });
    const events: string[] = [];
    soulSwitch.onEvent((event) => {
      events.push(event.type);
    });

    soulSwitch.registerAgent({
      id: "main",
      model: { providerId: "provider", modelId: "model" },
    });
    soulSwitch.registerModelProvider({
      id: "provider",
      async generate(request) {
        return {
          text: "ok",
          providerId: request.providerId,
          modelId: request.modelId,
        };
      },
    });

    await soulSwitch.run({ agentId: "main", prompt: "hello" });

    expect(events).toContain("run.started");
    expect(events).toContain("run.completed");
  });

  it("emits run failed event", async () => {
    const soulSwitch = createSoulSwitch({
      providers: {
        openaiCompatible: [],
      },
    });
    const events: string[] = [];
    soulSwitch.onEvent((event) => {
      events.push(event.type);
    });

    soulSwitch.registerAgent({
      id: "main",
      model: { providerId: "provider", modelId: "model" },
    });
    soulSwitch.registerModelProvider({
      id: "provider",
      async generate() {
        throw new Error("down");
      },
    });

    await expect(soulSwitch.run({ agentId: "main", prompt: "hello" })).rejects.toMatchObject({
      code: "RUN_FAILED",
    });
    expect(events).toContain("run.started");
    expect(events).toContain("run.failed");
  });

  it("executes tools and emits tool lifecycle events", async () => {
    const soulSwitch = createSoulSwitch({
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

    soulSwitch.registerTool({
      name: "sum",
      description: "sum two numbers",
      async run(args) {
        const a = Number(args.a ?? 0);
        const b = Number(args.b ?? 0);
        return { content: String(a + b) };
      },
    });

    const events: string[] = [];
    soulSwitch.onEvent((event) => {
      events.push(event.type);
    });

    const result = await soulSwitch.executeTool({
      name: "sum",
      args: { a: 2, b: 3 },
      context: { agentId: "main" },
    });

    expect(result.content).toBe("5");
    expect(events).toContain("tool.started");
    expect(events).toContain("tool.completed");
  });

  it("runs plugin beforeTool and afterTool hooks", async () => {
    const soulSwitch = createSoulSwitch({
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

    soulSwitch.registerTool({
      name: "echo",
      description: "echo",
      async run(args) {
        return { content: String(args.value ?? "") };
      },
    });

    const calls: string[] = [];
    await soulSwitch.registerPlugin({
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

    const result = await soulSwitch.executeTool({
      name: "echo",
      args: { value: "hello" },
      context: { agentId: "main" },
    });

    expect(result.content).toBe("hello");
    expect(calls).toEqual(["beforeTool", "afterTool"]);
  });

  it("emits tool failed event when execution fails", async () => {
    const soulSwitch = createSoulSwitch({
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

    soulSwitch.registerTool({
      name: "fail",
      description: "fails always",
      async run() {
        throw new Error("boom");
      },
    });

    const events: string[] = [];
    soulSwitch.onEvent((event) => {
      events.push(event.type);
    });

    await expect(
      soulSwitch.executeTool({
        name: "fail",
        context: { agentId: "main" },
      }),
    ).rejects.toMatchObject({ code: "TOOL_FAILED" });

    expect(events).toContain("tool.started");
    expect(events).toContain("tool.failed");
  });

  it("times out long-running tools", async () => {
    const soulSwitch = createSoulSwitch({
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

    soulSwitch.registerTool({
      name: "sleepy",
      description: "sleeps",
      async run() {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return { content: "late" };
      },
    });

    await expect(
      soulSwitch.executeTool({
        name: "sleepy",
        context: { agentId: "main" },
      }),
    ).rejects.toMatchObject({ code: "TOOL_TIMEOUT" });
  });

  it("supports tool cancellation via AbortSignal", async () => {
    const soulSwitch = createSoulSwitch({
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

    soulSwitch.registerTool({
      name: "wait",
      description: "waits",
      async run() {
        await new Promise((resolve) => setTimeout(resolve, 150));
        return { content: "done" };
      },
    });

    const events: string[] = [];
    soulSwitch.onEvent((event) => {
      events.push(event.type);
    });

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);

    await expect(
      soulSwitch.executeTool({
        name: "wait",
        context: { agentId: "main" },
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "TOOL_CANCELLED" });

    expect(events).toContain("tool.cancelled");
  });

  it("loads plugins from path and directory", async () => {
    const soulSwitch = createSoulSwitch({
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

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "soulSwitch-load-plugins-"));
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
      soulSwitch.onEvent((event) => {
        if (event.type === "plugin.registered") {
          events.push(event.data.pluginId);
        }
      });

      await soulSwitch.loadPluginFromPath(pluginAPath);
      const loaded = await soulSwitch.loadPluginsFromDirectory(tempDir);

      expect(events).toContain("loaded-a");
      expect(events).toContain("loaded-b");
      expect(loaded).toContain("loaded-b");
      expect(loaded).not.toContain("loaded-a");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("enforces tool denylist", async () => {
    const soulSwitch = createSoulSwitch({
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
      soulSwitch.registerTool({
        name: "dangerous",
        description: "blocked",
        async run() {
          return { content: "x" };
        },
      }),
    ).toThrowError(/Tool is denied by global configuration/);
  });

  it("enforces tool allowlist", async () => {
    const soulSwitch = createSoulSwitch({
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
      soulSwitch.registerTool({
        name: "other",
        description: "blocked",
        async run() {
          return { content: "x" };
        },
      }),
    ).toThrowError(/Tool is not in global allowlist/);
  });

  it("enforces agent-level tool policy", async () => {
    const soulSwitch = createSoulSwitch({
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

    soulSwitch.registerAgent({
      id: "restricted",
      tools: {
        allow: ["safe"],
      },
    });

    soulSwitch.registerTool({
      name: "unsafe",
      description: "unsafe",
      async run() {
        return { content: "x" };
      },
    });

    await expect(
      soulSwitch.executeTool({
        name: "unsafe",
        context: { agentId: "restricted" },
      }),
    ).rejects.toMatchObject({ code: "TOOL_NOT_ALLOWED" });
  });

  it("enforces run-level tool policy during run tool loops", async () => {
    const soulSwitch = createSoulSwitch({
      providers: {
        openaiCompatible: [],
      },
      models: {
        toolLoopMaxSteps: 1,
      },
    });

    soulSwitch.registerAgent({
      id: "main",
      model: { providerId: "provider", modelId: "m" },
    });
    soulSwitch.registerTool({
      name: "sum",
      description: "sum",
      async run(args) {
        return { content: String(Number(args.a ?? 0) + Number(args.b ?? 0)) };
      },
    });
    soulSwitch.registerModelProvider({
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
      soulSwitch.run({
        agentId: "main",
        prompt: "Compute",
        tools: { deny: ["sum"] },
      }),
    ).rejects.toMatchObject({ code: "TOOL_NOT_ALLOWED" });
  });

  it("applies beforeModel hook overrides", async () => {
    const soulSwitch = createSoulSwitch({
      providers: {
        openaiCompatible: [],
      },
    });

    soulSwitch.registerAgent({
      id: "main",
      model: {
        providerId: "provider-a",
        modelId: "model-a",
      },
    });

    soulSwitch.registerModelProvider({
      id: "provider-a",
      async generate() {
        throw new Error("should be overridden");
      },
    });

    soulSwitch.registerModelProvider({
      id: "provider-b",
      async generate(request) {
        return {
          text: `from-${request.providerId}-${request.modelId}`,
          providerId: request.providerId,
          modelId: request.modelId,
        };
      },
    });

    await soulSwitch.registerPlugin({
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

    const result = await soulSwitch.run({ agentId: "main", prompt: "hello" });

    expect(result.text).toBe("from-provider-b-model-b");
    expect(result.providerId).toBe("provider-b");
    expect(result.modelId).toBe("model-b");
  });

  it("applies beforePersonaLoad hooks", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "soulSwitch-persona-hook-"));
    try {
      await fs.writeFile(path.join(workspace, "SOUL.md"), "original soul", "utf8");

      const soulSwitch = createSoulSwitch({
        providers: {
          openaiCompatible: [],
        },
      });

      soulSwitch.registerAgent({ id: "main", model: { providerId: "provider", modelId: "m" } });

      let seenSystem = "";
      soulSwitch.registerModelProvider({
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

      await soulSwitch.registerPlugin({
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

      await soulSwitch.run({
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
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "soulSwitch-persona-hook-context-"));
    try {
      await fs.writeFile(path.join(workspace, "SOUL.md"), "original soul", "utf8");

      const soulSwitch = createSoulSwitch({
        providers: {
          openaiCompatible: [],
        },
      });

      soulSwitch.registerAgent({ id: "main", model: { providerId: "provider", modelId: "m" } });
      soulSwitch.registerModelProvider({
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

      await soulSwitch.registerPlugin({
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

      await soulSwitch.run({
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
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "soulSwitch-persona-hook-path-"));
    try {
      await fs.writeFile(path.join(workspace, "SOUL.md"), "original soul", "utf8");

      const soulSwitch = createSoulSwitch({
        providers: {
          openaiCompatible: [],
        },
      });

      soulSwitch.registerAgent({ id: "main", model: { providerId: "provider", modelId: "m" } });

      let seenSystem = "";
      soulSwitch.registerModelProvider({
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

      await soulSwitch.registerPlugin({
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

      const result = await soulSwitch.run({
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
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "soulSwitch-persona-hook-trim-"));
    try {
      const soulSwitch = createSoulSwitch({
        providers: {
          openaiCompatible: [],
        },
      });

      soulSwitch.registerAgent({ id: "main", model: { providerId: "provider", modelId: "m" } });

      let seenSystem = "";
      soulSwitch.registerModelProvider({
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

      await soulSwitch.registerPlugin({
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

      await soulSwitch.run({
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
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "soulSwitch-persona-session-"));
    try {
      await fs.writeFile(path.join(workspace, "MEMORY.md"), "main memory", "utf8");
      await fs.writeFile(path.join(workspace, "AGENTS.md"), "agents", "utf8");

      const soulSwitch = createSoulSwitch({
        providers: {
          openaiCompatible: [],
        },
      });
      soulSwitch.registerAgent({ id: "main", model: { providerId: "provider", modelId: "m" } });

      const systems: string[] = [];
      soulSwitch.registerModelProvider({
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

      await soulSwitch.run({
        agentId: "main",
        prompt: "hello",
        workspaceDir: workspace,
        sessionId: "agent:main:main",
      });
      await soulSwitch.run({
        agentId: "main",
        prompt: "hello",
        workspaceDir: workspace,
        sessionId: "agent:main:subagent:child-1",
      });
      await soulSwitch.run({
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
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "soulSwitch-persona-cache-"));
    try {
      await fs.writeFile(path.join(workspace, "SOUL.md"), "v1", "utf8");

      const soulSwitch = createSoulSwitch({
        providers: {
          openaiCompatible: [],
        },
      });
      soulSwitch.registerAgent({ id: "main", model: { providerId: "provider", modelId: "m" } });

      const systems: string[] = [];
      soulSwitch.registerModelProvider({
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

      await soulSwitch.run({
        agentId: "main",
        prompt: "hello",
        workspaceDir: workspace,
        sessionId: "agent:main:main",
      });

      await fs.writeFile(path.join(workspace, "SOUL.md"), "v2", "utf8");

      await soulSwitch.run({
        agentId: "main",
        prompt: "hello",
        workspaceDir: workspace,
        sessionId: "agent:main:main",
      });
      await soulSwitch.run({
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
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "soulSwitch-persona-cacheless-"));
    try {
      await fs.writeFile(path.join(workspace, "SOUL.md"), "v1", "utf8");

      const soulSwitch = createSoulSwitch({
        providers: {
          openaiCompatible: [],
        },
      });
      soulSwitch.registerAgent({ id: "main", model: { providerId: "provider", modelId: "m" } });

      const systems: string[] = [];
      soulSwitch.registerModelProvider({
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

      await soulSwitch.run({
        agentId: "main",
        prompt: "hello",
        workspaceDir: workspace,
      });

      await fs.writeFile(path.join(workspace, "SOUL.md"), "v2", "utf8");

      await soulSwitch.run({
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
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "soulSwitch-persona-extra-"));
    try {
      await fs.mkdir(path.join(workspace, "nested"), { recursive: true });
      await fs.writeFile(path.join(workspace, "SOUL.md"), "root soul", "utf8");
      await fs.writeFile(path.join(workspace, "nested", "SOUL.md"), "nested soul", "utf8");

      const soulSwitch = createSoulSwitch({
        providers: {
          openaiCompatible: [],
        },
        persona: {
          extraFiles: ["nested/SOUL.md"],
        },
      });

      soulSwitch.registerAgent({ id: "main", model: { providerId: "provider", modelId: "m" } });

      let seenSystem = "";
      soulSwitch.registerModelProvider({
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

      await soulSwitch.run({
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
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "soulSwitch-persona-lightweight-heartbeat-"));
    try {
      await fs.writeFile(path.join(workspace, "SOUL.md"), "soul", "utf8");
      await fs.writeFile(path.join(workspace, "HEARTBEAT.md"), "heartbeat", "utf8");

      const soulSwitch = createSoulSwitch({
        providers: {
          openaiCompatible: [],
        },
      });
      soulSwitch.registerAgent({ id: "main", model: { providerId: "provider", modelId: "m" } });

      let seenSystem = "";
      soulSwitch.registerModelProvider({
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

      await soulSwitch.run({
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
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "soulSwitch-persona-lightweight-cron-"));
    try {
      await fs.writeFile(path.join(workspace, "SOUL.md"), "soul", "utf8");
      await fs.writeFile(path.join(workspace, "HEARTBEAT.md"), "heartbeat", "utf8");

      const soulSwitch = createSoulSwitch({
        providers: {
          openaiCompatible: [],
        },
      });
      soulSwitch.registerAgent({ id: "main", model: { providerId: "provider", modelId: "m" } });

      let seenSystem = "unset";
      soulSwitch.registerModelProvider({
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

      await soulSwitch.run({
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
    const soulSwitch = createSoulSwitch({
      providers: {
        openaiCompatible: [],
      },
    });

    soulSwitch.registerAgent({
      id: "main",
      model: {
        providerId: "provider",
        modelId: "model",
      },
    });

    soulSwitch.registerModelProvider({
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
    soulSwitch.onEvent((event) => {
      events.push(event.type);
    });

    await soulSwitch.run({ agentId: "main", prompt: "hello" });

    expect(events).toContain("model.started");
    expect(events).toContain("model.completed");
  });

  it("returns runId and includes it in run/model events", async () => {
    const soulSwitch = createSoulSwitch({
      providers: {
        openaiCompatible: [],
      },
    });

    soulSwitch.registerAgent({
      id: "main",
      model: {
        providerId: "provider",
        modelId: "model",
      },
    });
    soulSwitch.registerModelProvider({
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
    soulSwitch.onEvent((event) => {
      if (
        event.type === "run.started" ||
        event.type === "model.started" ||
        event.type === "model.completed" ||
        event.type === "run.completed"
      ) {
        runIds.add(event.runId);
      }
    });

    const result = await soulSwitch.run({ agentId: "main", prompt: "hello" });

    expect(result.runId.length).toBeGreaterThan(0);
    expect(runIds.size).toBe(1);
    expect(runIds.has(result.runId)).toBe(true);
  });

  it("lists recent events and run-specific events", async () => {
    const soulSwitch = createSoulSwitch({
      providers: {
        openaiCompatible: [],
      },
    });

    soulSwitch.registerAgent({
      id: "main",
      model: {
        providerId: "provider",
        modelId: "model",
      },
    });
    soulSwitch.registerModelProvider({
      id: "provider",
      async generate(request) {
        return {
          text: "ok",
          providerId: request.providerId,
          modelId: request.modelId,
        };
      },
    });

    const result = await soulSwitch.run({ agentId: "main", prompt: "hello" });
    const recent = soulSwitch.listEvents(5);
    const runEvents = soulSwitch.listRunEvents(result.runId);

    expect(recent.length).toBeGreaterThan(0);
    expect(runEvents.length).toBeGreaterThan(0);
    expect(runEvents.every((event) => "runId" in event && event.runId === result.runId)).toBe(true);
  });

  it("includes runId in tool events when provided in context", async () => {
    const soulSwitch = createSoulSwitch({
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

    soulSwitch.registerTool({
      name: "echo",
      description: "echo",
      async run(args) {
        return { content: String(args.value ?? "") };
      },
    });

    const seenRunIds: string[] = [];
    soulSwitch.onEvent((event) => {
      if (event.type === "tool.started" || event.type === "tool.completed") {
        if (event.data.runId) {
          seenRunIds.push(event.data.runId);
        }
      }
    });

    await soulSwitch.executeTool({
      name: "echo",
      args: { value: "v" },
      context: { agentId: "main", runId: "run-123" },
    });

    expect(seenRunIds).toEqual(["run-123", "run-123"]);
  });

  it("cancels run before model execution when signal already aborted", async () => {
    const soulSwitch = createSoulSwitch({
      providers: {
        openaiCompatible: [],
      },
    });

    soulSwitch.registerAgent({
      id: "main",
      model: {
        providerId: "provider",
        modelId: "model",
      },
    });
    soulSwitch.registerModelProvider({
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
      soulSwitch.run({
        agentId: "main",
        prompt: "hello",
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "RUN_CANCELLED" });
  });

  it("emits run.cancelled when a run is aborted", async () => {
    const soulSwitch = createSoulSwitch({
      providers: {
        openaiCompatible: [],
      },
      models: {
        requestTimeoutMs: 500,
      },
    });

    soulSwitch.registerAgent({
      id: "main",
      model: {
        providerId: "slow",
        modelId: "model",
      },
    });
    soulSwitch.registerModelProvider({
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
    soulSwitch.onEvent((event) => {
      events.push(event.type);
    });

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);

    await expect(
      soulSwitch.run({
        agentId: "main",
        prompt: "hello",
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "RUN_CANCELLED" });

    expect(events).toContain("run.cancelled");
  });

  it("retries model requests before failing over", async () => {
    let primaryCalls = 0;
    const soulSwitch = createSoulSwitch({
      providers: {
        openaiCompatible: [],
      },
      models: {
        retriesPerModel: 1,
      },
    });

    soulSwitch.registerAgent({
      id: "main",
      model: {
        providerId: "primary",
        modelId: "one",
      },
    });

    soulSwitch.registerModelProvider({
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

    const result = await soulSwitch.run({ agentId: "main", prompt: "hello" });

    expect(primaryCalls).toBe(2);
    expect(result.text).toBe("ok-after-retry");
  });

  it("times out slow models and falls back", async () => {
    const soulSwitch = createSoulSwitch({
      providers: {
        openaiCompatible: [],
      },
      models: {
        requestTimeoutMs: 10,
      },
    });

    soulSwitch.registerAgent({
      id: "main",
      model: {
        providerId: "slow",
        modelId: "one",
        fallbacks: [{ providerId: "fast", modelId: "two" }],
      },
    });

    soulSwitch.registerModelProvider({
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

    soulSwitch.registerModelProvider({
      id: "fast",
      async generate(request) {
        return {
          text: "fallback-fast",
          providerId: request.providerId,
          modelId: request.modelId,
        };
      },
    });

    const result = await soulSwitch.run({ agentId: "main", prompt: "hello" });

    expect(result.text).toBe("fallback-fast");
    expect(result.providerId).toBe("fast");
  });

  it("tracks active runs and supports cancellation by runId", async () => {
    const soulSwitch = createSoulSwitch({
      providers: {
        openaiCompatible: [],
      },
      models: {
        requestTimeoutMs: 1_000,
      },
    });

    soulSwitch.registerAgent({
      id: "main",
      model: {
        providerId: "slow",
        modelId: "m",
      },
    });
    soulSwitch.registerModelProvider({
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

    const runPromise = soulSwitch.run({ agentId: "main", prompt: "hello" });
    await new Promise((resolve) => setTimeout(resolve, 10));

    const active = soulSwitch.listActiveRuns();
    expect(active.length).toBe(1);
    const runId = active[0]?.runId;
    expect(runId).toBeTruthy();
    expect(soulSwitch.cancelRun(runId ?? "")).toBe(true);
    await expect(runPromise).rejects.toMatchObject({ code: "RUN_CANCELLED" });
    expect(soulSwitch.listActiveRuns()).toHaveLength(0);
  });

  it("stores run summaries for completed runs", async () => {
    const soulSwitch = createSoulSwitch({
      providers: {
        openaiCompatible: [],
      },
    });
    soulSwitch.registerAgent({
      id: "main",
      model: { providerId: "provider", modelId: "model" },
    });
    soulSwitch.registerModelProvider({
      id: "provider",
      async generate(request) {
        return {
          text: "ok",
          providerId: request.providerId,
          modelId: request.modelId,
        };
      },
    });

    const result = await soulSwitch.run({ agentId: "main", prompt: "hello" });
    const summary = soulSwitch.getRun(result.runId);

    expect(summary?.status).toBe("completed");
    expect(summary?.providerId).toBe("provider");
    expect(summary?.modelId).toBe("model");
    expect(soulSwitch.listRuns(1)[0]?.runId).toBe(result.runId);
  });

  it("stores run summaries for cancelled runs", async () => {
    const soulSwitch = createSoulSwitch({
      providers: {
        openaiCompatible: [],
      },
    });
    soulSwitch.registerAgent({
      id: "main",
      model: { providerId: "slow", modelId: "model" },
    });
    soulSwitch.registerModelProvider({
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

    const runPromise = soulSwitch.run({ agentId: "main", prompt: "hello" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const runId = soulSwitch.listActiveRuns()[0]?.runId ?? "";
    soulSwitch.cancelRun(runId);
    await expect(runPromise).rejects.toMatchObject({ code: "RUN_CANCELLED" });

    const summary = soulSwitch.getRun(runId);
    expect(summary?.status).toBe("cancelled");
    expect(summary?.finishedAt).toBeTruthy();
  });

  it("reports run status statistics", async () => {
    const soulSwitch = createSoulSwitch({
      providers: {
        openaiCompatible: [],
      },
      models: {
        requestTimeoutMs: 1_000,
      },
    });

    soulSwitch.registerAgent({
      id: "ok",
      model: { providerId: "ok-provider", modelId: "m" },
    });
    soulSwitch.registerModelProvider({
      id: "ok-provider",
      async generate(request) {
        return {
          text: "ok",
          providerId: request.providerId,
          modelId: request.modelId,
        };
      },
    });

    soulSwitch.registerAgent({
      id: "fail",
      model: { providerId: "fail-provider", modelId: "m" },
    });
    soulSwitch.registerModelProvider({
      id: "fail-provider",
      async generate() {
        throw new Error("boom");
      },
    });

    soulSwitch.registerAgent({
      id: "cancel",
      model: { providerId: "slow-provider", modelId: "m" },
    });
    soulSwitch.registerModelProvider({
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

    await soulSwitch.run({ agentId: "ok", prompt: "hello" });
    await expect(soulSwitch.run({ agentId: "fail", prompt: "hello" })).rejects.toMatchObject({
      code: "RUN_FAILED",
    });

    const cancelPromise = soulSwitch.run({ agentId: "cancel", prompt: "hello" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const cancelRunId = soulSwitch.listActiveRuns()[0]?.runId ?? "";
    soulSwitch.cancelRun(cancelRunId);
    await expect(cancelPromise).rejects.toMatchObject({ code: "RUN_CANCELLED" });

    const stats = soulSwitch.getRunStats();
    expect(stats.total).toBeGreaterThanOrEqual(3);
    expect(stats.completed).toBeGreaterThanOrEqual(1);
    expect(stats.failed).toBeGreaterThanOrEqual(1);
    expect(stats.cancelled).toBeGreaterThanOrEqual(1);
  });

  it("returns diagnostics snapshot with counts and recent events", async () => {
    const soulSwitch = createSoulSwitch({
      providers: {
        openaiCompatible: [],
      },
    });

    soulSwitch.registerAgent({ id: "main", model: { providerId: "provider", modelId: "m" } });
    soulSwitch.registerTool({
      name: "echo",
      description: "echo",
      async run(args) {
        return { content: String(args.value ?? "") };
      },
    });
    soulSwitch.registerModelProvider({
      id: "provider",
      async generate(request) {
        return {
          text: "ok",
          providerId: request.providerId,
          modelId: request.modelId,
        };
      },
    });

    await soulSwitch.run({ agentId: "main", prompt: "hello" });
    await soulSwitch.executeTool({ name: "echo", args: { value: "v" }, context: { agentId: "main" } });

    const snapshot = soulSwitch.getDiagnostics({ recentEventsLimit: 5 });

    expect(snapshot.generatedAt.length).toBeGreaterThan(0);
    expect(snapshot.counts.agents).toBe(1);
    expect(snapshot.counts.tools).toBe(1);
    expect(snapshot.counts.providers).toBe(1);
    expect(snapshot.recentEvents.length).toBeLessThanOrEqual(5);
    expect(snapshot.runStats.total).toBeGreaterThanOrEqual(1);
  });

  it("resets diagnostics history and run summaries", async () => {
    const soulSwitch = createSoulSwitch({
      providers: {
        openaiCompatible: [],
      },
    });

    soulSwitch.registerAgent({ id: "main", model: { providerId: "provider", modelId: "m" } });
    soulSwitch.registerModelProvider({
      id: "provider",
      async generate(request) {
        return {
          text: "ok",
          providerId: request.providerId,
          modelId: request.modelId,
        };
      },
    });

    await soulSwitch.run({ agentId: "main", prompt: "hello" });

    const before = soulSwitch.getDiagnostics();
    expect(before.runStats.total).toBeGreaterThan(0);
    expect(before.recentEvents.length).toBeGreaterThan(0);

    const reset = soulSwitch.resetDiagnostics();
    expect(reset.clearedRuns).toBeGreaterThan(0);
    expect(reset.clearedEvents).toBeGreaterThan(0);

    const after = soulSwitch.getDiagnostics();
    expect(after.runStats.total).toBe(0);
    expect(after.recentEvents).toHaveLength(0);
  });

  it("queries runs by agent and status", async () => {
    const soulSwitch = createSoulSwitch({
      providers: {
        openaiCompatible: [],
      },
      models: {
        requestTimeoutMs: 1_000,
      },
    });

    soulSwitch.registerAgent({
      id: "alpha",
      model: { providerId: "ok", modelId: "m" },
    });
    soulSwitch.registerAgent({
      id: "beta",
      model: { providerId: "bad", modelId: "m" },
    });

    soulSwitch.registerModelProvider({
      id: "ok",
      async generate(request) {
        return {
          text: "ok",
          providerId: request.providerId,
          modelId: request.modelId,
        };
      },
    });
    soulSwitch.registerModelProvider({
      id: "bad",
      async generate() {
        throw new Error("boom");
      },
    });

    await soulSwitch.run({ agentId: "alpha", prompt: "hello" });
    await expect(soulSwitch.run({ agentId: "beta", prompt: "hello" })).rejects.toMatchObject({
      code: "RUN_FAILED",
    });

    const alphaCompleted = soulSwitch.queryRuns({ agentId: "alpha", status: "completed" });
    const betaFailed = soulSwitch.queryRuns({ agentId: "beta", status: "failed" });

    expect(alphaCompleted.length).toBeGreaterThanOrEqual(1);
    expect(alphaCompleted.every((run) => run.agentId === "alpha")).toBe(true);
    expect(alphaCompleted.every((run) => run.status === "completed")).toBe(true);

    expect(betaFailed.length).toBeGreaterThanOrEqual(1);
    expect(betaFailed.every((run) => run.agentId === "beta")).toBe(true);
    expect(betaFailed.every((run) => run.status === "failed")).toBe(true);

    const before = new Date(Date.now() - 1_000).toISOString();
    const after = new Date(Date.now() + 1_000).toISOString();
    const inWindow = soulSwitch.queryRuns({ since: before, until: after });
    expect(inWindow.length).toBeGreaterThanOrEqual(2);

    const futureOnly = soulSwitch.queryRuns({ since: new Date(Date.now() + 60_000).toISOString() });
    expect(futureOnly).toHaveLength(0);
  });

  it("queries events by type and runId", async () => {
    const soulSwitch = createSoulSwitch({
      providers: {
        openaiCompatible: [],
      },
    });

    soulSwitch.registerAgent({ id: "main", model: { providerId: "provider", modelId: "m" } });
    soulSwitch.registerModelProvider({
      id: "provider",
      async generate(request) {
        return {
          text: "ok",
          providerId: request.providerId,
          modelId: request.modelId,
        };
      },
    });

    const result = await soulSwitch.run({ agentId: "main", prompt: "hello" });

    const completed = soulSwitch.queryEvents({ type: "run.completed" });
    expect(completed.length).toBeGreaterThanOrEqual(1);

    const byRun = soulSwitch.queryEvents({ runId: result.runId });
    expect(byRun.length).toBeGreaterThan(0);
    expect(byRun.every((event) => ("runId" in event ? event.runId === result.runId : true))).toBe(
      true,
    );

    const before = new Date(Date.now() - 1_000).toISOString();
    const after = new Date(Date.now() + 1_000).toISOString();
    const inRange = soulSwitch.queryEvents({ runId: result.runId, since: before, until: after });
    expect(inRange.length).toBeGreaterThan(0);

    const futureRange = soulSwitch.queryEvents({
      runId: result.runId,
      since: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(futureRange).toHaveLength(0);
  });

  it("executes tool loop rounds when model returns JSON tool calls", async () => {
    const soulSwitch = createSoulSwitch({
      providers: {
        openaiCompatible: [],
      },
      models: {
        toolLoopMaxSteps: 2,
      },
    });

    soulSwitch.registerAgent({ id: "main", model: { providerId: "provider", modelId: "m" } });
    soulSwitch.registerTool({
      name: "sum",
      description: "sum",
      async run(args) {
        return { content: String(Number(args.a ?? 0) + Number(args.b ?? 0)) };
      },
    });

    let calls = 0;
    soulSwitch.registerModelProvider({
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

    const result = await soulSwitch.run({ agentId: "main", prompt: "What is 2+3?" });
    expect(result.text).toBe("The answer is 5.");
    expect(calls).toBe(2);
  });

  it("saves and loads state snapshots", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "soulSwitch-state-"));
    const statePath = path.join(stateDir, "state.json");
    try {
      const soulSwitchA = createSoulSwitch({
        providers: {
          openaiCompatible: [],
        },
      });
      soulSwitchA.registerAgent({ id: "main", model: { providerId: "provider", modelId: "m" } });
      soulSwitchA.registerModelProvider({
        id: "provider",
        async generate(request) {
          return {
            text: "ok",
            providerId: request.providerId,
            modelId: request.modelId,
          };
        },
      });
      soulSwitchA.registerSessionTools();
      await soulSwitchA.run({ agentId: "main", prompt: "hello", sessionId: "main" });
      await soulSwitchA.saveState(statePath);

      const soulSwitchB = createSoulSwitch({
        providers: {
          openaiCompatible: [],
        },
      });
      soulSwitchB.registerSessionTools();
      const loadedPath = await soulSwitchB.loadState(statePath);
      expect(loadedPath.endsWith("state.json")).toBe(true);
      expect(soulSwitchB.getRunStats().total).toBeGreaterThanOrEqual(1);
      expect(soulSwitchB.listEvents(10).length).toBeGreaterThan(0);
      const sessions = await soulSwitchB.executeTool({
        name: "sessions_list",
        args: {},
        context: { agentId: "main" },
      });
      expect(sessions.content).toContain("main");
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });

  it("redacts configured keys when saving state snapshots", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "soulSwitch-redact-state-"));
    const statePath = path.join(stateDir, "state.json");
    try {
      const soulSwitch = createSoulSwitch({
        security: {
          redactKeys: ["authorization"],
        },
        providers: {
          openaiCompatible: [],
        },
      });

      soulSwitch.onEvent((event) => {
        if (event.type === "run.failed") {
          Object.assign(event.data, {
            authorization: "secret-token",
          });
        }
      });

      soulSwitch.registerAgent({
        id: "main",
        model: { providerId: "bad", modelId: "m" },
      });
      soulSwitch.registerModelProvider({
        id: "bad",
        async generate() {
          throw new Error("authorization=secret-token");
        },
      });

      await expect(soulSwitch.run({ agentId: "main", prompt: "x" })).rejects.toMatchObject({
        code: "RUN_FAILED",
      });
      await soulSwitch.saveState(statePath);

      const raw = await fs.readFile(statePath, "utf8");
      expect(raw.includes('"authorization": "[REDACTED]"')).toBe(true);
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });

  it("auto-persists and auto-loads state when runtime.stateFile is configured", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "soulSwitch-auto-state-"));
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
      const soulSwitchA = createSoulSwitch({
        runtime: {
          stateFile: statePath,
        },
        providers: {
          openaiCompatible: [],
        },
      });
      soulSwitchA.registerAgent({ id: "main", model: { providerId: "provider", modelId: "m" } });
      soulSwitchA.registerModelProvider({
        id: "provider",
        async generate(request) {
          return {
            text: "ok",
            providerId: request.providerId,
            modelId: request.modelId,
          };
        },
      });
      await soulSwitchA.run({ agentId: "main", prompt: "hello" });

      await waitFor(async () => {
        try {
          await fs.access(statePath);
          return true;
        } catch {
          return false;
        }
      });

      const soulSwitchB = createSoulSwitch({
        runtime: {
          stateFile: statePath,
        },
        providers: {
          openaiCompatible: [],
        },
      });

      await waitFor(() => soulSwitchB.getRunStats().total > 0);
      expect(soulSwitchB.getRunStats().total).toBeGreaterThanOrEqual(1);
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });
});
