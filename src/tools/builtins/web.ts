import { TalosError } from "../../errors.js";
import type {
  ToolDefinition,
  WebFetchToolOptions,
  WebSearchResultItem,
  WebSearchToolOptions,
} from "../../types.js";

const DEFAULT_WEB_FETCH_MAX_CHARS = 50_000;
const DEFAULT_WEB_FETCH_TIMEOUT_MS = 30_000;
const DEFAULT_WEB_FETCH_MAX_RESPONSE_BYTES = 2_000_000;
const DEFAULT_WEB_FETCH_MAX_REDIRECTS = 3;
const DEFAULT_WEB_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const PRIVATE_HOSTNAME_PATTERN =
  /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|::1$|fc00:|fd00:|fe80:)/i;

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

function normalizeUrl(rawUrl: string, allowPrivateNetwork: boolean): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new TalosError({
      code: "TOOL_FAILED",
      message: `Invalid URL: ${rawUrl}`,
    });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TalosError({
      code: "TOOL_FAILED",
      message: `web_fetch only supports http/https URLs: ${rawUrl}`,
    });
  }
  if (!allowPrivateNetwork && PRIVATE_HOSTNAME_PATTERN.test(parsed.hostname)) {
    throw new TalosError({
      code: "TOOL_FAILED",
      message: `Blocked private/internal hostname for web_fetch: ${parsed.hostname}`,
    });
  }
  return parsed.toString();
}

function normalizeCountry(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toUpperCase();
  if (!normalized) {
    return undefined;
  }
  if (!/^([A-Z]{2}|ALL)$/.test(normalized)) {
    throw new TalosError({
      code: "TOOL_FAILED",
      message: "country must be a 2-letter code or ALL.",
    });
  }
  return normalized;
}

function normalizeSearchLang(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (!/^[a-z]{2}$/.test(normalized)) {
    throw new TalosError({
      code: "TOOL_FAILED",
      message: "search_lang must be a 2-letter ISO language code like 'en'.",
    });
  }
  return normalized;
}

function normalizeUiLang(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  if (!/^[a-z]{2}-[A-Z]{2}$/.test(normalized)) {
    throw new TalosError({
      code: "TOOL_FAILED",
      message: "ui_lang must be a language-region locale like 'en-US'.",
    });
  }
  return normalized;
}

function normalizeFreshness(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (/^(pd|pw|pm|py)$/.test(normalized)) {
    return normalized;
  }
  if (/^\d{4}-\d{2}-\d{2}to\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return normalized;
  }
  throw new TalosError({
    code: "TOOL_FAILED",
    message: "freshness must be one of pd/pw/pm/py or YYYY-MM-DDtoYYYY-MM-DD.",
  });
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
  timeoutMs: number;
  maxResponseBytes: number;
  maxRedirects: number;
  userAgent: string;
}): Promise<{ content: string; title?: string }> {
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), params.timeoutMs);
  try {
    let currentUrl = params.url;
    for (let redirectCount = 0; redirectCount <= params.maxRedirects; redirectCount += 1) {
      const response = await fetch(currentUrl, {
        method: "GET",
        redirect: "manual",
        signal: timeoutController.signal,
        headers: {
          "user-agent": params.userAgent,
          "accept-language": "en-US,en;q=0.9",
        },
      });
      const isRedirect = response.status >= 300 && response.status < 400;
      if (isRedirect) {
        if (redirectCount >= params.maxRedirects) {
          throw new TalosError({
            code: "TOOL_FAILED",
            message: `web_fetch exceeded max redirects (${params.maxRedirects}): ${params.url}`,
          });
        }
        const location = response.headers.get("location");
        if (!location) {
          throw new TalosError({
            code: "TOOL_FAILED",
            message: `web_fetch redirect missing Location header: ${currentUrl}`,
          });
        }
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }
      if (!response.ok) {
        throw new TalosError({
          code: "TOOL_FAILED",
          message: `web_fetch request failed (${response.status}): ${currentUrl}`,
        });
      }
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      if (reader) {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) {
            break;
          }
          if (chunk.value) {
            totalBytes += chunk.value.byteLength;
            if (totalBytes > params.maxResponseBytes) {
              throw new TalosError({
                code: "TOOL_FAILED",
                message: `web_fetch response exceeded maxResponseBytes (${params.maxResponseBytes}).`,
              });
            }
            chunks.push(chunk.value);
          }
        }
      }
      const textDecoder = new TextDecoder();
      const html = chunks.map((chunk) => textDecoder.decode(chunk, { stream: true })).join("");
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const title = titleMatch?.[1]?.trim();
      const text = htmlToText(html);
      const capped = text.slice(0, Math.max(1, params.maxChars));
      return {
        content: capped,
        ...(title ? { title } : {}),
      };
    }
    throw new TalosError({
      code: "TOOL_FAILED",
      message: `web_fetch could not fetch URL: ${params.url}`,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export function createWebSearchTool(options: WebSearchToolOptions): ToolDefinition {
  const cache = new Map<string, { expiresAt: number; data: WebSearchResultItem[] }>();
  const cacheTtlMs = options.cacheTtlMs ?? 15 * 60_000;
  return {
    name: options.name ?? "web_search",
    description: options.description ?? "Search the web for relevant results",
    async run(args) {
      const query = requireString(args.query, "query");
      const count = Math.min(10, toPositiveInt(args.count, 5));
      const country = normalizeCountry(args.country);
      const searchLang = normalizeSearchLang(args.search_lang);
      const uiLang = normalizeUiLang(args.ui_lang);
      const freshness = normalizeFreshness(args.freshness);
      const cacheKey = JSON.stringify({ query, count, country, searchLang, uiLang, freshness });
      const now = Date.now();
      const cached = cache.get(cacheKey);
      const results =
        cached && cached.expiresAt > now
          ? cached.data
          : normalizeSearchResults(
              await options.search({
                query,
                count,
                ...(country ? { country } : {}),
                ...(searchLang ? { searchLang } : {}),
                ...(uiLang ? { uiLang } : {}),
                ...(freshness ? { freshness } : {}),
              }),
            );
      if (!cached || cached.expiresAt <= now) {
        cache.set(cacheKey, {
          expiresAt: now + cacheTtlMs,
          data: results,
        });
      }
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
          ...(country ? { country } : {}),
          ...(searchLang ? { search_lang: searchLang } : {}),
          ...(uiLang ? { ui_lang: uiLang } : {}),
          ...(freshness ? { freshness } : {}),
          cached: Boolean(cached && cached.expiresAt > now),
          results,
        },
      };
    },
  };
}

export function createWebFetchTool(options?: WebFetchToolOptions): ToolDefinition {
  const fetchContent = options?.fetchContent ?? defaultFetchContent;
  const defaultMaxChars = options?.defaultMaxChars ?? DEFAULT_WEB_FETCH_MAX_CHARS;
  const maxCharsCap = options?.maxCharsCap ?? DEFAULT_WEB_FETCH_MAX_CHARS;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_WEB_FETCH_TIMEOUT_MS;
  const maxResponseBytes = options?.maxResponseBytes ?? DEFAULT_WEB_FETCH_MAX_RESPONSE_BYTES;
  const maxRedirects = options?.maxRedirects ?? DEFAULT_WEB_FETCH_MAX_REDIRECTS;
  const userAgent = options?.userAgent ?? DEFAULT_WEB_USER_AGENT;
  const cacheTtlMs = options?.cacheTtlMs ?? 15 * 60_000;
  const allowPrivateNetwork = options?.allowPrivateNetwork === true;
  const cache = new Map<string, { expiresAt: number; data: { content: string; title?: string } }>();
  return {
    name: options?.name ?? "web_fetch",
    description: options?.description ?? "Fetch and extract content from a URL",
    async run(args) {
      const url = normalizeUrl(requireString(args.url, "url"), allowPrivateNetwork);
      const extractMode = args.extractMode === "text" ? "text" : "markdown";
      const maxChars = Math.min(maxCharsCap, toPositiveInt(args.maxChars, defaultMaxChars));
      const cacheKey = JSON.stringify({ url, extractMode, maxChars });
      const now = Date.now();
      const cached = cache.get(cacheKey);
      const fetched =
        cached && cached.expiresAt > now
          ? cached.data
          : await fetchContent({
              url,
              extractMode,
              maxChars,
              timeoutMs,
              maxResponseBytes,
              maxRedirects,
              userAgent,
            });
      if (!cached || cached.expiresAt <= now) {
        cache.set(cacheKey, {
          expiresAt: now + cacheTtlMs,
          data: fetched,
        });
      }
      return {
        content: fetched.title ? `${fetched.title}\n\n${fetched.content}` : fetched.content,
        data: {
          url,
          extractMode,
          maxChars,
          cached: Boolean(cached && cached.expiresAt > now),
          ...(fetched.title ? { title: fetched.title } : {}),
        },
      };
    },
  };
}
