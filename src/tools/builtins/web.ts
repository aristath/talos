import { SoulSwitchError } from "../../errors.js";
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
const SEARCH_PROVIDERS = new Set(["brave", "duckduckgo", "perplexity", "gemini", "grok", "kimi"]);

function requireString(value: unknown, field: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    throw new SoulSwitchError({
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
    throw new SoulSwitchError({
      code: "TOOL_FAILED",
      message: `Invalid URL: ${rawUrl}`,
    });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SoulSwitchError({
      code: "TOOL_FAILED",
      message: `web_fetch only supports http/https URLs: ${rawUrl}`,
    });
  }
  if (!allowPrivateNetwork && PRIVATE_HOSTNAME_PATTERN.test(parsed.hostname)) {
    throw new SoulSwitchError({
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
    throw new SoulSwitchError({
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
    throw new SoulSwitchError({
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
    throw new SoulSwitchError({
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
  throw new SoulSwitchError({
    code: "TOOL_FAILED",
    message: "freshness must be one of pd/pw/pm/py or YYYY-MM-DDtoYYYY-MM-DD.",
  });
}

function normalizeProvider(value: unknown): "brave" | "duckduckgo" | "perplexity" | "gemini" | "grok" | "kimi" | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (!SEARCH_PROVIDERS.has(normalized)) {
    throw new SoulSwitchError({
      code: "TOOL_FAILED",
      message: `Unsupported web_search provider: ${normalized}`,
    });
  }
  return normalized as "brave" | "duckduckgo" | "perplexity" | "gemini" | "grok" | "kimi";
}

function autoDetectProvider(): "brave" | "duckduckgo" | "perplexity" | "gemini" | "grok" | "kimi" {
  if (process.env.BRAVE_API_KEY?.trim()) {
    return "brave";
  }
  if (process.env.GEMINI_API_KEY?.trim()) {
    return "gemini";
  }
  if (process.env.KIMI_API_KEY?.trim() || process.env.MOONSHOT_API_KEY?.trim()) {
    return "kimi";
  }
  if (process.env.PERPLEXITY_API_KEY?.trim() || process.env.OPENROUTER_API_KEY?.trim()) {
    return "perplexity";
  }
  if (process.env.XAI_API_KEY?.trim()) {
    return "grok";
  }
  return "duckduckgo";
}

function resolveProviderApiKey(
  provider: "brave" | "duckduckgo" | "perplexity" | "gemini" | "grok" | "kimi",
): string | undefined {
  switch (provider) {
    case "brave":
      return process.env.BRAVE_API_KEY?.trim() || undefined;
    case "duckduckgo":
      return undefined;
    case "perplexity":
      return process.env.PERPLEXITY_API_KEY?.trim() || process.env.OPENROUTER_API_KEY?.trim() || undefined;
    case "gemini":
      return process.env.GEMINI_API_KEY?.trim() || undefined;
    case "grok":
      return process.env.XAI_API_KEY?.trim() || undefined;
    case "kimi":
      return process.env.KIMI_API_KEY?.trim() || process.env.MOONSHOT_API_KEY?.trim() || undefined;
  }
}

function normalizeSearchResults(items: WebSearchResultItem[]): WebSearchResultItem[] {
  const normalizeResultUrl = (rawUrl: string): string => {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.hostname.endsWith("google.com") && parsed.pathname === "/url") {
        const q = parsed.searchParams.get("q");
        if (q) {
          return q;
        }
      }
      return parsed.toString();
    } catch {
      return rawUrl;
    }
  };

  return items
    .map((item) => {
      const title = item.title.trim();
      const url = normalizeResultUrl(item.url.trim());
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

function extractReadableHtml(input: string): string {
  const article = input.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  if (article?.[1]) {
    return article[1];
  }
  const main = input.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  if (main?.[1]) {
    return main[1];
  }
  return input;
}

function stripMarkdownCodeFences(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (!match) {
    return trimmed;
  }
  return (match[1] ?? "").trim();
}

function parseSearchJsonPayload(raw: string): WebSearchResultItem[] {
  const normalized = stripMarkdownCodeFences(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const title = typeof (entry as { title?: unknown }).title === "string" ? (entry as { title: string }).title.trim() : "";
      const url = typeof (entry as { url?: unknown }).url === "string" ? (entry as { url: string }).url.trim() : "";
      const snippet =
        typeof (entry as { snippet?: unknown }).snippet === "string"
          ? (entry as { snippet: string }).snippet.trim()
          : "";
      if (!title || !url) {
        return null;
      }
      return {
        title,
        url,
        ...(snippet ? { snippet } : {}),
      };
    })
    .filter((entry): entry is WebSearchResultItem => Boolean(entry));
}

async function providerModelSearch(params: {
  provider: "perplexity" | "gemini" | "grok" | "kimi";
  providerApiKey: string;
  query: string;
  count: number;
}): Promise<WebSearchResultItem[]> {
  const endpoint =
    params.provider === "perplexity"
      ? "https://api.perplexity.ai/chat/completions"
      : params.provider === "gemini"
        ? "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
        : params.provider === "grok"
          ? "https://api.x.ai/v1/chat/completions"
          : "https://api.moonshot.ai/v1/chat/completions";
  const model =
    params.provider === "perplexity"
      ? "sonar"
      : params.provider === "gemini"
        ? "gemini-2.5-pro"
        : params.provider === "grok"
          ? "grok-2-latest"
          : "kimi-k2-0711-preview";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.providerApiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "You are a web search formatter. Return ONLY valid JSON array of {title,url,snippet}. No markdown.",
        },
        {
          role: "user",
          content: `Query: ${params.query}\nReturn top ${params.count} web results as JSON array with title,url,snippet.`,
        },
      ],
      temperature: 0,
      max_tokens: 700,
      ...(params.provider === "perplexity" ? { search_domain_filter: [], return_citations: true } : {}),
    }),
  });
  if (!response.ok) {
    throw new SoulSwitchError({
      code: "TOOL_FAILED",
      message: `${params.provider} web_search failed (${response.status}).`,
    });
  }
  const payload = (await response.json()) as {
    citations?: string[];
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = payload.choices?.[0]?.message?.content?.trim() ?? "";
  const parsed = text ? parseSearchJsonPayload(text) : [];
  if (parsed.length > 0) {
    return parsed.slice(0, params.count);
  }
  const citations = Array.isArray(payload.citations) ? payload.citations : [];
  if (citations.length > 0) {
    return citations.slice(0, params.count).map((url, index) => ({
      title: `Result ${index + 1}`,
      url,
    }));
  }
  throw new SoulSwitchError({
    code: "TOOL_FAILED",
    message: `${params.provider} web_search returned no usable results.`,
  });
}

async function defaultWebSearch(params: {
  query: string;
  count: number;
  provider?: "brave" | "duckduckgo" | "perplexity" | "gemini" | "grok" | "kimi";
  providerApiKey?: string;
  country?: string;
  searchLang?: string;
  uiLang?: string;
  freshness?: string;
}): Promise<WebSearchResultItem[]> {
  const provider = params.provider ?? "brave";
  if (provider === "duckduckgo") {
    const url = new URL("https://api.duckduckgo.com/");
    url.searchParams.set("q", params.query);
    url.searchParams.set("format", "json");
    url.searchParams.set("no_html", "1");
    url.searchParams.set("skip_disambig", "1");
    const parsePayload = (raw: string) => {
      if (!raw.trim()) {
        return undefined;
      }
      try {
        return JSON.parse(raw) as {
          AbstractText?: string;
          AbstractURL?: string;
          Heading?: string;
          RelatedTopics?: Array<
            | {
                Text?: string;
                FirstURL?: string;
              }
            | {
                Topics?: Array<{
                  Text?: string;
                  FirstURL?: string;
                }>;
              }
          >;
          Results?: Array<{
            Text?: string;
            FirstURL?: string;
          }>;
        };
      } catch {
        return undefined;
      }
    };
    let payload:
      | {
          AbstractText?: string;
          AbstractURL?: string;
          Heading?: string;
          RelatedTopics?: Array<
            | {
                Text?: string;
                FirstURL?: string;
              }
            | {
                Topics?: Array<{
                  Text?: string;
                  FirstURL?: string;
                }>;
              }
          >;
          Results?: Array<{
            Text?: string;
            FirstURL?: string;
          }>;
        }
      | undefined;
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch(url.toString(), {
          headers: {
            Accept: "application/json",
          },
        });
        if (!response.ok) {
          throw new SoulSwitchError({
            code: "TOOL_FAILED",
            message: `DuckDuckGo web_search failed (${response.status}).`,
          });
        }
        const raw = await response.text();
        payload = parsePayload(raw);
        break;
      } catch (error) {
        lastError = error;
      }
    }
    const parsedPayload = (payload ?? {
      RelatedTopics: [],
      Results: [],
    }) as {
      AbstractText?: string;
      AbstractURL?: string;
      Heading?: string;
      RelatedTopics?: Array<
        | {
            Text?: string;
            FirstURL?: string;
          }
        | {
            Topics?: Array<{
              Text?: string;
              FirstURL?: string;
            }>;
          }
      >;
      Results?: Array<{
        Text?: string;
        FirstURL?: string;
      }>;
    };
    const items: WebSearchResultItem[] = [];
    const pushResult = (entry: { text: string | undefined; url: string | undefined }, fallbackIndex: number) => {
      const snippet = (entry.text ?? "").trim();
      const urlValue = (entry.url ?? "").trim();
      if (!urlValue) {
        return;
      }
      const title = snippet.split(" - ")[0]?.trim() || `Result ${fallbackIndex + 1}`;
      items.push({
        title,
        url: urlValue,
        ...(snippet ? { snippet } : {}),
      });
    };
    if (parsedPayload.AbstractURL?.trim()) {
      items.push({
        title: parsedPayload.Heading?.trim() || "DuckDuckGo Result",
        url: parsedPayload.AbstractURL.trim(),
        ...(parsedPayload.AbstractText?.trim() ? { snippet: parsedPayload.AbstractText.trim() } : {}),
      });
    }
    const related = Array.isArray(parsedPayload.RelatedTopics) ? parsedPayload.RelatedTopics : [];
    for (const entry of related) {
      if (items.length >= params.count) {
        break;
      }
      if (entry && typeof entry === "object" && Array.isArray((entry as { Topics?: unknown }).Topics)) {
        const nested = (entry as { Topics: Array<{ Text?: string; FirstURL?: string }> }).Topics;
        for (const nestedEntry of nested) {
          if (items.length >= params.count) {
            break;
          }
          pushResult(
            {
              text: nestedEntry.Text,
              url: nestedEntry.FirstURL,
            },
            items.length,
          );
        }
        continue;
      }
      pushResult(
        {
          text: (entry as { Text?: string }).Text,
          url: (entry as { FirstURL?: string }).FirstURL,
        },
        items.length,
      );
    }
    const directResults = Array.isArray(parsedPayload.Results) ? parsedPayload.Results : [];
    for (const entry of directResults) {
      if (items.length >= params.count) {
        break;
      }
      pushResult(
        {
          text: entry.Text,
          url: entry.FirstURL,
        },
        items.length,
      );
    }
    const deduped: WebSearchResultItem[] = [];
    const seen = new Set<string>();
    for (const entry of items) {
      const key = entry.url.trim();
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      deduped.push(entry);
      if (deduped.length >= params.count) {
        break;
      }
    }
    if (deduped.length > 0) {
      return deduped;
    }

    const htmlUrl = new URL("https://html.duckduckgo.com/html/");
    htmlUrl.searchParams.set("q", params.query);
    const htmlResponse = await fetch(htmlUrl.toString(), {
      headers: {
        Accept: "text/html",
        "User-Agent": DEFAULT_WEB_USER_AGENT,
      },
    });
    if (!htmlResponse.ok) {
      throw new SoulSwitchError({
        code: "TOOL_FAILED",
        message: `DuckDuckGo web_search failed (${htmlResponse.status}).`,
      });
    }
    const html = await htmlResponse.text();
    const matches = html.matchAll(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi);
    for (const match of matches) {
      const rawHref = (match[1] ?? "").replace(/&amp;/g, "&").trim();
      const title = htmlToText(match[2] ?? "").trim();
      if (!rawHref || !title) {
        continue;
      }
      const withProtocol = rawHref.startsWith("//") ? `https:${rawHref}` : rawHref;
      let resolvedUrl = withProtocol;
      try {
        const parsed = new URL(withProtocol);
        if (parsed.hostname.endsWith("duckduckgo.com") && parsed.pathname === "/l/") {
          const uddg = parsed.searchParams.get("uddg")?.trim();
          if (uddg) {
            resolvedUrl = uddg;
          }
        }
      } catch {
        continue;
      }
      if (seen.has(resolvedUrl)) {
        continue;
      }
      seen.add(resolvedUrl);
      deduped.push({
        title,
        url: resolvedUrl,
      });
      if (deduped.length >= params.count) {
        break;
      }
    }
    return deduped;
  }
  if (provider === "brave") {
    if (!params.providerApiKey) {
      throw new SoulSwitchError({
        code: "TOOL_FAILED",
        message: "web_search provider 'brave' requires BRAVE_API_KEY (or providerApiKeys.brave).",
      });
    }
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", params.query);
    url.searchParams.set("count", String(params.count));
    if (params.country) {
      url.searchParams.set("country", params.country);
    }
    if (params.searchLang) {
      url.searchParams.set("search_lang", params.searchLang);
    }
    if (params.uiLang) {
      url.searchParams.set("ui_lang", params.uiLang);
    }
    if (params.freshness) {
      url.searchParams.set("freshness", params.freshness);
    }
    const response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": params.providerApiKey,
      },
    });
    if (!response.ok) {
      throw new SoulSwitchError({
        code: "TOOL_FAILED",
        message: `Brave web_search failed (${response.status}).`,
      });
    }
    const payload = (await response.json()) as {
      web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
    };
    const results = payload.web?.results ?? [];
    return results
      .map((entry) => {
        const title = entry.title?.trim();
        const url = entry.url?.trim();
        if (!title || !url) {
          return null;
        }
        return {
          title,
          url,
          ...(entry.description?.trim() ? { snippet: entry.description.trim() } : {}),
        };
      })
      .filter((entry): entry is WebSearchResultItem => Boolean(entry));
  }

  if (!params.providerApiKey) {
    throw new SoulSwitchError({
      code: "TOOL_FAILED",
      message: `web_search provider '${provider}' requires a provider API key.`,
    });
  }
  return await providerModelSearch({
    provider,
    providerApiKey: params.providerApiKey,
    query: params.query,
    count: params.count,
  });
}

async function defaultFirecrawlFallback(params: {
  url: string;
  extractMode: "markdown" | "text";
  maxChars: number;
  timeoutMs: number;
}): Promise<{
  content: string;
  title?: string;
  finalUrl?: string;
  sourceUrl?: string;
  extractor?: string;
  warning?: string;
  rawLength?: number;
  wrappedLength?: number;
  truncated?: boolean;
}> {
  const apiKey = process.env.FIRECRAWL_API_KEY?.trim();
  if (!apiKey) {
    throw new SoulSwitchError({
      code: "TOOL_FAILED",
      message: "FIRECRAWL_API_KEY is required for web_fetch Firecrawl fallback.",
    });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs);
  try {
    const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url: params.url,
        formats: [params.extractMode === "text" ? "markdown" : "markdown"],
      }),
    });
    if (!response.ok) {
      throw new SoulSwitchError({
        code: "TOOL_FAILED",
        message: `Firecrawl fallback failed (${response.status}).`,
      });
    }
    const payload = (await response.json()) as {
      success?: boolean;
      data?: { markdown?: string; metadata?: { title?: string } };
    };
    const markdown = payload.data?.markdown?.trim() ?? "";
    if (!markdown) {
      throw new SoulSwitchError({
        code: "TOOL_FAILED",
        message: "Firecrawl fallback returned empty content.",
      });
    }
    const content = params.extractMode === "text" ? htmlToText(markdown) : markdown;
    const maxChars = Math.max(1, params.maxChars);
    const truncated = content.length > maxChars;
    const wrapped = content.slice(0, maxChars);
    return {
      content: truncated ? `${wrapped}\n\n[TRUNCATED]` : wrapped,
      ...(payload.data?.metadata?.title?.trim() ? { title: payload.data.metadata.title.trim() } : {}),
      finalUrl: params.url,
      sourceUrl: params.url,
      extractor: "firecrawl",
      rawLength: markdown.length,
      wrappedLength: content.length,
      truncated,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function defaultFetchContent(params: {
  url: string;
  extractMode: "markdown" | "text";
  maxChars: number;
  timeoutMs: number;
  maxResponseBytes: number;
  maxRedirects: number;
  userAgent: string;
  allowPrivateNetwork: boolean;
}): Promise<{
  content: string;
  title?: string;
  finalUrl?: string;
  sourceUrl?: string;
  statusCode?: number;
  contentType?: string;
  extractor?: string;
  warning?: string;
  rawLength?: number;
  wrappedLength?: number;
  truncated?: boolean;
}> {
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
          throw new SoulSwitchError({
            code: "TOOL_FAILED",
            message: `web_fetch exceeded max redirects (${params.maxRedirects}): ${params.url}`,
          });
        }
        const location = response.headers.get("location");
        if (!location) {
          throw new SoulSwitchError({
            code: "TOOL_FAILED",
            message: `web_fetch redirect missing Location header: ${currentUrl}`,
          });
        }
        currentUrl = new URL(location, currentUrl).toString();
        currentUrl = normalizeUrl(currentUrl, params.allowPrivateNetwork);
        continue;
      }
      if (!response.ok) {
        throw new SoulSwitchError({
          code: "TOOL_FAILED",
          message: `web_fetch request failed (${response.status}): ${currentUrl}`,
        });
      }
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      let responseTruncated = false;
      if (reader) {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) {
            break;
          }
          if (chunk.value) {
            totalBytes += chunk.value.byteLength;
            if (totalBytes > params.maxResponseBytes) {
              responseTruncated = true;
              const remaining = Math.max(0, params.maxResponseBytes - (totalBytes - chunk.value.byteLength));
              if (remaining > 0) {
                chunks.push(chunk.value.subarray(0, remaining));
              }
              break;
            }
            chunks.push(chunk.value);
          }
        }
      }
      const textDecoder = new TextDecoder();
      const html = chunks.map((chunk) => textDecoder.decode(chunk, { stream: true })).join("");
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const title = titleMatch?.[1]?.trim();
      const text = htmlToText(extractReadableHtml(html));
      const outputLimit = Math.max(1, params.maxChars);
      const outputTruncated = text.length > outputLimit;
      const capped = text.slice(0, outputLimit);
      const contentType = response.headers.get("content-type") ?? undefined;
      const truncated = responseTruncated || outputTruncated;
      return {
        content: truncated ? `${capped}\n\n[TRUNCATED]` : capped,
        ...(title ? { title } : {}),
        finalUrl: currentUrl,
        sourceUrl: currentUrl,
        statusCode: response.status,
        ...(contentType ? { contentType } : {}),
        extractor: "readability",
        ...(responseTruncated ? { warning: `Response body truncated after ${params.maxResponseBytes} bytes.` } : {}),
        rawLength: html.length,
        wrappedLength: text.length,
        truncated,
      };
    }
    throw new SoulSwitchError({
      code: "TOOL_FAILED",
      message: `web_fetch could not fetch URL: ${params.url}`,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export function createWebSearchTool(options: WebSearchToolOptions): ToolDefinition {
  const searchImpl = options.search ?? defaultWebSearch;
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
      const provider = normalizeProvider(args.provider) ?? options.defaultProvider ?? autoDetectProvider();
      const providerApiKey = options.providerApiKeys?.[provider] ?? resolveProviderApiKey(provider);
      const cacheKey = JSON.stringify({ query, count, provider, country, searchLang, uiLang, freshness });
      const now = Date.now();
      const cached = cache.get(cacheKey);
      const results =
        cached && cached.expiresAt > now
          ? cached.data
           : normalizeSearchResults(
              await searchImpl({
                query,
                count,
                ...(provider ? { provider } : {}),
                ...(providerApiKey ? { providerApiKey } : {}),
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
      const synthesizedContent = results
        .map((entry) => (entry.snippet ? `${entry.title}: ${entry.snippet}` : entry.title))
        .filter(Boolean)
        .join("\n");
      const citations = results.map((entry) => entry.url);
      return {
        content: content || "No web results.",
        data: {
          query,
          count,
          ...(provider ? { provider } : {}),
          ...(country ? { country } : {}),
          ...(searchLang ? { search_lang: searchLang } : {}),
          ...(uiLang ? { ui_lang: uiLang } : {}),
          ...(freshness ? { freshness } : {}),
          cached: Boolean(cached && cached.expiresAt > now),
          results,
          ...(provider !== "brave" ? { content: synthesizedContent || "No response", citations } : {}),
          externalContent: {
            untrusted: true,
            source: "web_search",
            provider,
            wrapped: true,
          },
          details: {
            query,
            count,
            provider,
            country,
            search_lang: searchLang,
            ui_lang: uiLang,
            freshness,
            cached: Boolean(cached && cached.expiresAt > now),
            resultCount: results.length,
            ...(provider !== "brave" ? { citationsCount: citations.length } : {}),
          },
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
  const cache = new Map<string, {
    expiresAt: number;
    data: {
      content: string;
      title?: string;
      finalUrl?: string;
      sourceUrl?: string;
      statusCode?: number;
      contentType?: string;
      extractor?: string;
      warning?: string;
      rawLength?: number;
      wrappedLength?: number;
      truncated?: boolean;
    };
  }>();
  const firecrawlFallback = options?.firecrawlFallback ?? (process.env.FIRECRAWL_API_KEY?.trim() ? defaultFirecrawlFallback : undefined);
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
              allowPrivateNetwork,
            });
      let resolved = fetched;
      let usedFallback = false;
      if (!cached && firecrawlFallback && fetched.content.trim().length < 200) {
        const fallback = await firecrawlFallback({
          url,
          extractMode,
          maxChars,
          timeoutMs,
        });
        if (fallback.content.trim().length > fetched.content.trim().length) {
          resolved = fallback;
          usedFallback = true;
        }
      }
      if (!cached || cached.expiresAt <= now) {
        cache.set(cacheKey, {
          expiresAt: now + cacheTtlMs,
          data: resolved,
        });
      }
      const contentLimit = Math.max(1, maxChars);
      const contentTruncated = Boolean(resolved.truncated) || resolved.content.length > contentLimit;
      const content = contentTruncated ? `${resolved.content.slice(0, contentLimit)}\n\n[TRUNCATED]` : resolved.content;
      return {
        content: resolved.title ? `${resolved.title}\n\n${content}` : content,
        data: {
          url,
          finalUrl: resolved.finalUrl ?? resolved.sourceUrl ?? url,
          extractMode,
          maxChars,
          cached: Boolean(cached && cached.expiresAt > now),
          usedFallback,
          truncated: contentTruncated,
          ...(resolved.extractor ? { extractor: resolved.extractor } : {}),
          ...(resolved.warning ? { warning: resolved.warning } : {}),
          ...(resolved.sourceUrl ? { sourceUrl: resolved.sourceUrl } : {}),
          ...(typeof resolved.statusCode === "number" ? { statusCode: resolved.statusCode } : {}),
          ...(resolved.contentType ? { contentType: resolved.contentType } : {}),
          ...(typeof resolved.rawLength === "number" ? { rawLength: resolved.rawLength } : {}),
          ...(typeof resolved.wrappedLength === "number" ? { wrappedLength: resolved.wrappedLength } : {}),
          ...(resolved.title ? { title: resolved.title } : {}),
          externalContent: {
            untrusted: true,
            source: "web_fetch",
            wrapped: true,
          },
          details: {
            url,
            extractMode,
            maxChars,
            cached: Boolean(cached && cached.expiresAt > now),
            usedFallback,
            truncated: contentTruncated,
            finalUrl: resolved.finalUrl ?? resolved.sourceUrl ?? url,
            extractor: resolved.extractor,
            warning: resolved.warning,
            sourceUrl: resolved.sourceUrl,
            statusCode: resolved.statusCode,
            contentType: resolved.contentType,
            rawLength: resolved.rawLength,
            wrappedLength: resolved.wrappedLength,
            title: resolved.title,
          },
        },
      };
    },
  };
}
