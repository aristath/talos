import { TalosError } from "../../errors.js";
import type {
  ToolDefinition,
  WebFetchToolOptions,
  WebSearchResultItem,
  WebSearchToolOptions,
} from "../../types.js";

const DEFAULT_WEB_FETCH_MAX_CHARS = 50_000;

function requireString(value: unknown, field: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    throw new TalosError({
      code: "TOOL_FAILED",
      message: `web tool requires a non-empty '${field}' string.`,
    });
  }
  return normalized;
}

function toPositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  const normalized = Math.floor(value);
  if (normalized <= 0) {
    return fallback;
  }
  return normalized;
}

function normalizeSearchResults(items: WebSearchResultItem[]): WebSearchResultItem[] {
  return items
    .map((item) => {
      const title = item.title.trim();
      const url = item.url.trim();
      if (!title || !url) {
        return null;
      }
      return {
        title,
        url,
        ...(item.snippet?.trim() ? { snippet: item.snippet.trim() } : {}),
      };
    })
    .filter((item): item is WebSearchResultItem => Boolean(item));
}

function htmlToText(input: string): string {
  const withoutScripts = input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");
  const decoded = withoutScripts
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return decoded
    .replace(/<[^>]+>/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function defaultFetchContent(params: {
  url: string;
  extractMode: "markdown" | "text";
  maxChars: number;
}): Promise<{ content: string; title?: string }> {
  const response = await fetch(params.url);
  if (!response.ok) {
    throw new TalosError({
      code: "TOOL_FAILED",
      message: `web_fetch request failed (${response.status}): ${params.url}`,
    });
  }
  const html = await response.text();
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch?.[1]?.trim();
  const text = htmlToText(html);
  const capped = text.slice(0, Math.max(1, params.maxChars));
  if (params.extractMode === "markdown") {
    return {
      content: capped,
      ...(title ? { title } : {}),
    };
  }
  return {
    content: capped,
    ...(title ? { title } : {}),
  };
}

export function createWebSearchTool(options: WebSearchToolOptions): ToolDefinition {
  return {
    name: options.name ?? "web_search",
    description: options.description ?? "Search the web for relevant results",
    async run(args) {
      const query = requireString(args.query, "query");
      const count = Math.min(10, toPositiveInt(args.count, 5));
      const results = normalizeSearchResults(await options.search({ query, count }));
      const content = results
        .map((entry, index) => {
          const prefix = `${index + 1}. ${entry.title} (${entry.url})`;
          return entry.snippet ? `${prefix}\n${entry.snippet}` : prefix;
        })
        .join("\n\n");
      return {
        content: content || "No web results.",
        data: {
          query,
          count,
          results,
        },
      };
    },
  };
}

export function createWebFetchTool(options?: WebFetchToolOptions): ToolDefinition {
  const fetchContent = options?.fetchContent ?? defaultFetchContent;
  const defaultMaxChars = options?.defaultMaxChars ?? DEFAULT_WEB_FETCH_MAX_CHARS;
  return {
    name: options?.name ?? "web_fetch",
    description: options?.description ?? "Fetch and extract content from a URL",
    async run(args) {
      const url = requireString(args.url, "url");
      const extractMode = args.extractMode === "text" ? "text" : "markdown";
      const maxChars = Math.min(250_000, toPositiveInt(args.maxChars, defaultMaxChars));
      const fetched = await fetchContent({
        url,
        extractMode,
        maxChars,
      });
      return {
        content: fetched.title ? `${fetched.title}\n\n${fetched.content}` : fetched.content,
        data: {
          url,
          extractMode,
          maxChars,
          ...(fetched.title ? { title: fetched.title } : {}),
        },
      };
    },
  };
}
