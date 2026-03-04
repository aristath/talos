import { afterEach, describe, expect, it, vi } from "vitest";
import { createWebFetchTool, createWebSearchTool } from "./web.js";

describe("web builtins", () => {
  const originalFirecrawl = process.env.FIRECRAWL_API_KEY;
  const originalBrave = process.env.BRAVE_API_KEY;

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

    const result = await tool.run({ query: "talos", provider: "gemini" }, { agentId: "main" });
    const urls = (result.data as { results: Array<{ url: string }> }).results.map((entry) => entry.url);
    expect(urls).toContain("https://example.com/a");
    expect((result.data as { citations?: string[] }).citations).toContain("https://example.com/a");
    expect(typeof (result.data as { content?: string }).content).toBe("string");
  });

  it("requires key for non-brave providers", async () => {
    const tool = createWebSearchTool({
      defaultProvider: "gemini",
    });

    await expect(tool.run({ query: "talos", provider: "gemini" }, { agentId: "main" })).rejects.toMatchObject({
      code: "TOOL_FAILED",
    });
  });

  it("requires key for brave provider in built-in search", async () => {
    delete process.env.BRAVE_API_KEY;
    const tool = createWebSearchTool({
      defaultProvider: "brave",
    });

    await expect(tool.run({ query: "talos" }, { agentId: "main" })).rejects.toMatchObject({
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
        sourceUrl: "https://example.com/final",
        statusCode: 200,
        contentType: "text/html",
        rawLength: 1234,
        wrappedLength: 456,
        truncated: false,
      }),
    });

    const result = await tool.run({ url: "https://example.com" }, { agentId: "main" });
    const data = result.data as {
      sourceUrl?: string;
      statusCode?: number;
      contentType?: string;
      rawLength?: number;
      wrappedLength?: number;
      details?: {
        sourceUrl?: string;
        statusCode?: number;
        contentType?: string;
      };
    };
    expect(data.sourceUrl).toBe("https://example.com/final");
    expect(data.statusCode).toBe(200);
    expect(data.contentType).toBe("text/html");
    expect(data.rawLength).toBe(1234);
    expect(data.wrappedLength).toBe(456);
    expect(data.details?.sourceUrl).toBe("https://example.com/final");
  });
});
