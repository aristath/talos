import { afterEach, describe, expect, it, vi } from "vitest";
import { createWebFetchTool, createWebSearchTool } from "./web.js";

describe("web builtins", () => {
  const originalFirecrawl = process.env.FIRECRAWL_API_KEY;
  const originalBrave = process.env.BRAVE_API_KEY;
  const originalPerplexity = process.env.PERPLEXITY_API_KEY;
  const originalOpenRouter = process.env.OPENROUTER_API_KEY;
  const originalGemini = process.env.GEMINI_API_KEY;
  const originalXai = process.env.XAI_API_KEY;
  const originalKimi = process.env.KIMI_API_KEY;
  const originalMoonshot = process.env.MOONSHOT_API_KEY;

  afterEach(() => {
    vi.restoreAllMocks();
    if (typeof originalFirecrawl === "string") {
      process.env.FIRECRAWL_API_KEY = originalFirecrawl;
    } else {
      delete process.env.FIRECRAWL_API_KEY;
    }
    if (typeof originalBrave === "string") {
      process.env.BRAVE_API_KEY = originalBrave;
    } else {
      delete process.env.BRAVE_API_KEY;
    }
    if (typeof originalPerplexity === "string") {
      process.env.PERPLEXITY_API_KEY = originalPerplexity;
    } else {
      delete process.env.PERPLEXITY_API_KEY;
    }
    if (typeof originalOpenRouter === "string") {
      process.env.OPENROUTER_API_KEY = originalOpenRouter;
    } else {
      delete process.env.OPENROUTER_API_KEY;
    }
    if (typeof originalGemini === "string") {
      process.env.GEMINI_API_KEY = originalGemini;
    } else {
      delete process.env.GEMINI_API_KEY;
    }
    if (typeof originalXai === "string") {
      process.env.XAI_API_KEY = originalXai;
    } else {
      delete process.env.XAI_API_KEY;
    }
    if (typeof originalKimi === "string") {
      process.env.KIMI_API_KEY = originalKimi;
    } else {
      delete process.env.KIMI_API_KEY;
    }
    if (typeof originalMoonshot === "string") {
      process.env.MOONSHOT_API_KEY = originalMoonshot;
    } else {
      delete process.env.MOONSHOT_API_KEY;
    }
  });

  it("supports duckduckgo provider without API key", async () => {
    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        async text() {
          return JSON.stringify({
            Heading: "SoulSwitch",
            AbstractText: "SoulSwitch is a persona runtime.",
            AbstractURL: "https://example.com/soulswitch",
            RelatedTopics: [
              {
                Text: "SoulSwitch docs - docs",
                FirstURL: "https://example.com/docs",
              },
              {
                Topics: [
                  {
                    Text: "SoulSwitch repo - source",
                    FirstURL: "https://example.com/repo",
                  },
                ],
              },
            ],
          });
        },
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const tool = createWebSearchTool({
      defaultProvider: "duckduckgo",
    });

    const result = await tool.run({ query: "SoulSwitch", count: 3 }, { agentId: "main" });
    const data = result.data as {
      provider?: string;
      results?: Array<{ url: string }>;
      citations?: string[];
      details?: { provider?: string; resultCount?: number };
    };
    expect(data.provider).toBe("duckduckgo");
    expect(data.results?.length).toBeGreaterThan(0);
    expect(data.results?.[0]?.url).toBe("https://example.com/soulswitch");
    expect(data.citations).toContain("https://example.com/docs");
    expect(data.details?.provider).toBe("duckduckgo");
  });

  it("auto-detects duckduckgo when no provider keys are configured", async () => {
    delete process.env.BRAVE_API_KEY;
    delete process.env.PERPLEXITY_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.XAI_API_KEY;
    delete process.env.KIMI_API_KEY;
    delete process.env.MOONSHOT_API_KEY;

    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        async text() {
          return JSON.stringify({
            RelatedTopics: [
              {
                Text: "Result one - snippet",
                FirstURL: "https://example.com/one",
              },
            ],
          });
        },
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const tool = createWebSearchTool({});
    const result = await tool.run({ query: "no keys" }, { agentId: "main" });
    const data = result.data as { provider?: string; results?: Array<{ url: string }> };
    expect(data.provider).toBe("duckduckgo");
    expect(data.results?.[0]?.url).toBe("https://example.com/one");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses provider model search for non-brave providers", async () => {
    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify([
                    { title: "Example A", url: "https://example.com/a", snippet: "snippet" },
                  ]),
                },
              },
            ],
          };
        },
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const tool = createWebSearchTool({
      defaultProvider: "gemini",
      providerApiKeys: {
        gemini: "gemini-key",
      },
    });

    const result = await tool.run({ query: "soulSwitch", provider: "gemini" }, { agentId: "main" });
    const urls = (result.data as { results: Array<{ url: string }> }).results.map((entry) => entry.url);
    expect(urls).toContain("https://example.com/a");
    expect((result.data as { citations?: string[] }).citations).toContain("https://example.com/a");
    expect(typeof (result.data as { content?: string }).content).toBe("string");
  });

  it("requires key for non-brave providers", async () => {
    const tool = createWebSearchTool({
      defaultProvider: "gemini",
    });

    await expect(tool.run({ query: "soulSwitch", provider: "gemini" }, { agentId: "main" })).rejects.toMatchObject({
      code: "TOOL_FAILED",
    });
  });

  it("requires key for brave provider in built-in search", async () => {
    delete process.env.BRAVE_API_KEY;
    const tool = createWebSearchTool({
      defaultProvider: "brave",
    });

    await expect(tool.run({ query: "soulSwitch" }, { agentId: "main" })).rejects.toMatchObject({
      code: "TOOL_FAILED",
    });
  });

  it("auto-uses firecrawl fallback when configured env key exists", async () => {
    process.env.FIRECRAWL_API_KEY = "firecrawl-key";
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("api.firecrawl.dev")) {
        return {
          ok: true,
          async json() {
            return {
              success: true,
              data: {
                markdown: "long fallback content from firecrawl",
                metadata: {
                  title: "Firecrawl",
                },
              },
            };
          },
        };
      }
      return {
        ok: true,
        async text() {
          return "<html></html>";
        },
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const tool = createWebFetchTool({
      fetchContent: async () => ({ content: "short" }),
    });

    const result = await tool.run({ url: "https://example.com" }, { agentId: "main" });
    expect(result.content).toContain("long fallback content from firecrawl");
    expect((result.data as { usedFallback?: boolean }).usedFallback).toBe(true);
  });

  it("returns fetch detail metadata for parity", async () => {
    const tool = createWebFetchTool({
      fetchContent: async () => ({
        content: "payload",
        title: "Title",
        finalUrl: "https://example.com/final",
        sourceUrl: "https://example.com/final",
        statusCode: 200,
        contentType: "text/html",
        extractor: "readability",
        warning: "warn",
        rawLength: 1234,
        wrappedLength: 456,
        truncated: false,
      }),
    });

    const result = await tool.run({ url: "https://example.com" }, { agentId: "main" });
    const data = result.data as {
      sourceUrl?: string;
      finalUrl?: string;
      statusCode?: number;
      contentType?: string;
      extractor?: string;
      warning?: string;
      rawLength?: number;
      wrappedLength?: number;
      externalContent?: { source?: string; wrapped?: boolean };
      details?: {
        sourceUrl?: string;
        statusCode?: number;
        contentType?: string;
      };
    };
    expect(data.sourceUrl).toBe("https://example.com/final");
    expect(data.finalUrl).toBe("https://example.com/final");
    expect(data.statusCode).toBe(200);
    expect(data.contentType).toBe("text/html");
    expect(data.extractor).toBe("readability");
    expect(data.warning).toBe("warn");
    expect(data.rawLength).toBe(1234);
    expect(data.wrappedLength).toBe(456);
    expect(data.externalContent?.source).toBe("web_fetch");
    expect(data.externalContent?.wrapped).toBe(true);
    expect(data.details?.sourceUrl).toBe("https://example.com/final");
  });
});
