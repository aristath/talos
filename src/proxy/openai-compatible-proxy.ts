import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { SoulSwitchError } from "../errors.js";
import { loadAgentRuntimeProfile, type AgentRuntimeProfile } from "../persona/agent-config.js";

type InboundAuthRule = {
  defaultAgentId: string;
  allowedAgentIds?: string[];
};

export type OpenAIProxyOptions = {
  workspaceDir: string;
  defaultAgentId: string;
  platformPrompt?: string;
  allowModelAlias?: boolean;
  inboundAuth?: Record<string, InboundAuthRule>;
  agentsDir?: string;
  profileConfigFileName?: string;
  upstreamTimeoutMs?: number;
  cacheTtlMs?: number;
};

export type OpenAIProxyReadyState = {
  ok: boolean;
  agentId: string;
  error?: string;
};

export type OpenAIProxyStats = {
  defaultAgentId: string;
  cacheEntries: number;
  cacheTtlMs: number;
  totalHandledRequests: number;
  upstreamAttempts: number;
  upstreamResponses: number;
  upstreamErrors: number;
  upstream5xxResponses: number;
};

type CachedAgentProfile = {
  expiresAt: number;
  profile: ResolvedAgentProfile;
};

type ResolvedAgentProfile = AgentRuntimeProfile & {
  agentId: string;
  prompt: string;
};

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function openAIError(
  status: number,
  message: string,
  type = "invalid_request_error",
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(
    JSON.stringify({
      error: {
        message,
        type,
      },
    }),
    {
      status,
      headers: {
        "content-type": "application/json",
        ...(extraHeaders ?? {}),
      },
    },
  );
}

function readBearerToken(request: Request): string | undefined {
  const auth = request.headers.get("authorization")?.trim();
  if (!auth) {
    return undefined;
  }
  const match = auth.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  return token || undefined;
}

function readInboundToken(request: Request): string | undefined {
  const bearer = readBearerToken(request);
  if (bearer) {
    return bearer;
  }
  const xApiKey = request.headers.get("x-api-key")?.trim();
  if (xApiKey) {
    return xApiKey;
  }
  const apiKey = request.headers.get("api-key")?.trim();
  if (apiKey) {
    return apiKey;
  }
  return undefined;
}

function extractRequestedAgentId(request: Request): string | undefined {
  const value = request.headers.get("x-agent-id")?.trim();
  return value || undefined;
}

function extractAgentIdFromModelAlias(payload: Record<string, unknown>): string | undefined {
  const model = typeof payload.model === "string" ? payload.model.trim() : "";
  if (!model.toLowerCase().startsWith("agent:")) {
    return undefined;
  }
  const agentId = model.slice("agent:".length).trim();
  return agentId || undefined;
}

function stripAgentModelAlias(payload: Record<string, unknown>): Record<string, unknown> {
  const model = typeof payload.model === "string" ? payload.model.trim() : "";
  if (!model.toLowerCase().startsWith("agent:")) {
    return payload;
  }
  const next = { ...payload };
  delete next.model;
  return next;
}

function mergePersonaIntoCompletionsPrompt(
  personaPrompt: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const prompt = payload.prompt;
  if (typeof prompt === "string") {
    return {
      ...payload,
      prompt: `${personaPrompt}\n\n${prompt}`,
    };
  }
  if (Array.isArray(prompt) && prompt.every((entry) => typeof entry === "string")) {
    const [first, ...rest] = prompt as string[];
    return {
      ...payload,
      prompt: [`${personaPrompt}\n\n${first ?? ""}`, ...rest],
    };
  }
  return {
    ...payload,
    prompt: `${personaPrompt}\n\n`,
  };
}

function parseJsonBody(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Request body must be a JSON object.");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new SoulSwitchError({
      code: "TOOL_FAILED",
      message: "Invalid JSON request body.",
      cause: error,
    });
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isJsonContentType(value: string | null): boolean {
  if (!value) {
    return true;
  }
  return value.toLowerCase().includes("application/json");
}

function validateChatCompletionsPayload(payload: Record<string, unknown>): string | undefined {
  if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
    return "chat/completions requires a non-empty messages array.";
  }
  return undefined;
}

function validateResponsesPayload(payload: Record<string, unknown>): string | undefined {
  const hasInput = Object.hasOwn(payload, "input");
  const hasInstructions = isNonEmptyString(payload.instructions);
  if (!hasInput && !hasInstructions) {
    return "responses requires input or instructions.";
  }
  return undefined;
}

function validateCompletionsPayload(payload: Record<string, unknown>): string | undefined {
  const prompt = payload.prompt;
  if (isNonEmptyString(prompt)) {
    return undefined;
  }
  if (Array.isArray(prompt) && prompt.every((entry) => typeof entry === "string") && prompt.length > 0) {
    return undefined;
  }
  return "completions requires a non-empty prompt string or string array.";
}

function validateEmbeddingsPayload(payload: Record<string, unknown>): string | undefined {
  if (!Object.hasOwn(payload, "input")) {
    return "embeddings requires input.";
  }
  return undefined;
}

async function readPersonaPrompt(agentDir: string): Promise<string> {
  const sections: string[] = [];
  const fileNames = ["SOUL.md", "STYLE.md", "RULES.md"];
  for (const fileName of fileNames) {
    const filePath = path.join(agentDir, fileName);
    const content = await fs.readFile(filePath, "utf8").catch(() => "");
    const trimmed = content.trim();
    if (!trimmed) {
      continue;
    }
    sections.push(`## ${fileName}\n${trimmed}`);
  }
  if (sections.length === 0) {
    throw new SoulSwitchError({
      code: "CONFIG_INVALID",
      message: `Agent persona files are empty in: ${agentDir}`,
    });
  }
  return ["Use this agent persona context when answering:", ...sections].join("\n\n");
}

function mergePersonaIntoChatMessages(
  personaPrompt: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  return {
    ...payload,
    messages: [{ role: "system", content: personaPrompt }, ...messages],
  };
}

function composePrompt(platformPrompt: string | undefined, personaPrompt: string): string {
  const platform = typeof platformPrompt === "string" ? platformPrompt.trim() : "";
  if (!platform) {
    return personaPrompt;
  }
  return `${platform}\n\n${personaPrompt}`;
}

function mergePersonaIntoResponsesInput(
  personaPrompt: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const instructions =
    typeof payload.instructions === "string" && payload.instructions.trim()
      ? `${personaPrompt}\n\n${payload.instructions}`
      : personaPrompt;
  return {
    ...payload,
    instructions,
  };
}

function buildProxyHeaders(params: {
  apiKey?: string;
  extraHeaders?: Record<string, string>;
  requestId?: string;
}): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(params.extraHeaders ?? {}),
  };
  if (params.requestId?.trim()) {
    headers["x-request-id"] = params.requestId.trim();
  }
  if (params.apiKey?.trim()) {
    headers.authorization = `Bearer ${params.apiKey.trim()}`;
  }
  return headers;
}

function resolveModelCandidates(params: {
  payloadModel?: unknown;
  defaultModel?: string;
  fallbackModels?: string[];
}): string[] {
  const explicitModel = typeof params.payloadModel === "string" ? params.payloadModel.trim() : "";
  if (explicitModel) {
    return [explicitModel];
  }
  const defaultModel = params.defaultModel?.trim() ?? "";
  const fallbackModels = (params.fallbackModels ?? []).map((entry) => entry.trim()).filter(Boolean);
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const candidate of [defaultModel, ...fallbackModels]) {
    if (!candidate || seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    ordered.push(candidate);
  }
  return ordered;
}

async function listAgentIds(workspaceDir: string, agentsDir: string): Promise<string[]> {
  const root = path.join(workspaceDir, agentsDir);
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

export function createOpenAICompatibleProxy(options: OpenAIProxyOptions): {
  handle: (request: Request) => Promise<Response>;
  ready: () => Promise<OpenAIProxyReadyState>;
  reload: (agentId?: string) => Promise<{ ok: boolean; cleared: number; agentId?: string }>;
  stats: () => OpenAIProxyStats;
} {
  const workspaceDir = options.workspaceDir.trim();
  const defaultAgentId = options.defaultAgentId.trim();
  const agentsDir = options.agentsDir?.trim() || "agents";
  const profileConfigFileName = options.profileConfigFileName?.trim() || "agent.json";
  const platformPrompt = options.platformPrompt?.trim() || undefined;
  const allowModelAlias = options.allowModelAlias !== false;
  const upstreamTimeoutMs = options.upstreamTimeoutMs ?? 60_000;
  const cacheTtlMs = options.cacheTtlMs ?? 5_000;
  const cache = new Map<string, CachedAgentProfile>();
  const counters = {
    totalHandledRequests: 0,
    upstreamAttempts: 0,
    upstreamResponses: 0,
    upstreamErrors: 0,
    upstream5xxResponses: 0,
  };

  const resolveAgentId = (request: Request, params?: { requestedAgentId?: string; requestId?: string }): string | Response => {
    const requestId = params?.requestId;
    const preferredAgentId = params?.requestedAgentId ?? extractRequestedAgentId(request);
    if (!options.inboundAuth) {
      return preferredAgentId ?? defaultAgentId;
    }
    const token = readInboundToken(request);
    if (!token) {
      return openAIError(401, "Missing bearer token.", "authentication_error", {
        ...(requestId ? { "x-request-id": requestId } : {}),
      });
    }
    const rule = options.inboundAuth[token];
    if (!rule) {
      return openAIError(403, "Invalid API token.", "authentication_error", {
        ...(requestId ? { "x-request-id": requestId } : {}),
      });
    }
    const allowedAgentIds = (rule.allowedAgentIds ?? [rule.defaultAgentId]).map((entry) => entry.trim());
    const selected = preferredAgentId ?? rule.defaultAgentId;
    if (!allowedAgentIds.includes(selected)) {
      return openAIError(403, `Agent access denied: ${selected}`, "permission_error", {
        ...(requestId ? { "x-request-id": requestId } : {}),
      });
    }
    return selected;
  };

  const resolveProfile = async (agentId: string): Promise<ResolvedAgentProfile> => {
    const now = Date.now();
    const cached = cache.get(agentId);
    if (cached && cached.expiresAt > now) {
      return cached.profile;
    }
    try {
      const runtime = await loadAgentRuntimeProfile({
        workspaceDir,
        agentId,
        agentsDir,
        configFileName: profileConfigFileName,
      });
      if (!runtime) {
        throw new SoulSwitchError({
          code: "AGENT_NOT_FOUND",
          message: `Agent persona not found: ${agentId}`,
        });
      }
      const prompt = await readPersonaPrompt(runtime.personaDir);
      const profile: ResolvedAgentProfile = {
        ...runtime,
        agentId,
        prompt,
      };
      cache.set(agentId, {
        expiresAt: now + cacheTtlMs,
        profile,
      });
      return profile;
    } catch (error) {
      if (cached) {
        return cached.profile;
      }
      throw error;
    }
  };

  const proxyJson = async (params: {
    endpoint: "/chat/completions" | "/responses" | "/completions" | "/embeddings";
    payload: Record<string, unknown>;
    profile: ResolvedAgentProfile;
    requestId: string;
  }): Promise<Response> => {
    const baseUrl = trimTrailingSlash(params.profile.baseUrl ?? "");
    if (!baseUrl) {
      return openAIError(500, `Agent ${params.profile.agentId} has no upstream baseURL configured.`);
    }
    const url = `${baseUrl}${params.endpoint}`;
    const headers = buildProxyHeaders({
      ...(params.profile.apiKey ? { apiKey: params.profile.apiKey } : {}),
      ...(params.profile.headers ? { extraHeaders: params.profile.headers } : {}),
      requestId: params.requestId,
    });
    const controller = new AbortController();
    const effectiveTimeoutMs =
      typeof params.profile.timeoutMs === "number" && Number.isFinite(params.profile.timeoutMs)
        ? params.profile.timeoutMs
        : upstreamTimeoutMs;
    const timeout = setTimeout(() => controller.abort(), effectiveTimeoutMs);
    const modelCandidates = resolveModelCandidates({
      payloadModel: params.payload.model,
      ...(params.profile.modelId ? { defaultModel: params.profile.modelId } : {}),
      ...(params.profile.fallbackModelIds ? { fallbackModels: params.profile.fallbackModelIds } : {}),
    });
    if (modelCandidates.length === 0) {
      return openAIError(500, "No model resolved for upstream request.", "api_error", {
        "x-request-id": params.requestId,
        "x-soulswitch-agent-id": params.profile.agentId,
      });
    }
    const payloadBase = { ...params.payload };
    delete payloadBase.model;
    try {
      let lastResponse: Response | undefined;
      let lastModel = modelCandidates[0] ?? "";
      for (const [index, model] of modelCandidates.entries()) {
        lastModel = model;
        counters.upstreamAttempts += 1;
        const upstream = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            ...payloadBase,
            model,
          }),
          signal: controller.signal,
        });
        counters.upstreamResponses += 1;
        if (upstream.status >= 500) {
          counters.upstream5xxResponses += 1;
        }
        if (upstream.ok || index >= modelCandidates.length - 1) {
          return new Response(upstream.body, {
            status: upstream.status,
            headers: {
              ...Object.fromEntries(upstream.headers.entries()),
              "x-request-id": params.requestId,
              "x-soulswitch-agent-id": params.profile.agentId,
              "x-soulswitch-model": model,
              "x-soulswitch-model-attempt": String(index + 1),
              "x-soulswitch-model-candidates": String(modelCandidates.length),
              ...(index > 0 ? { "x-soulswitch-model-fallback": "true" } : {}),
            },
          });
        }
        if (upstream.status < 500) {
          return new Response(upstream.body, {
            status: upstream.status,
            headers: {
              ...Object.fromEntries(upstream.headers.entries()),
              "x-request-id": params.requestId,
              "x-soulswitch-agent-id": params.profile.agentId,
              "x-soulswitch-model": model,
              "x-soulswitch-model-attempt": String(index + 1),
              "x-soulswitch-model-candidates": String(modelCandidates.length),
            },
          });
        }
        lastResponse = upstream;
      }
      if (lastResponse) {
        return new Response(lastResponse.body, {
          status: lastResponse.status,
          headers: {
            ...Object.fromEntries(lastResponse.headers.entries()),
            "x-request-id": params.requestId,
            "x-soulswitch-agent-id": params.profile.agentId,
            ...(lastModel ? { "x-soulswitch-model": lastModel } : {}),
            "x-soulswitch-model-attempt": String(modelCandidates.length),
            "x-soulswitch-model-candidates": String(modelCandidates.length),
          },
        });
      }
      throw new Error("Upstream request did not produce a response.");
    } catch (error) {
      counters.upstreamErrors += 1;
      return openAIError(
        502,
        error instanceof Error
          ? `Upstream request failed: ${error.message} (timeout=${effectiveTimeoutMs}ms)`
          : `Upstream request failed. (timeout=${effectiveTimeoutMs}ms)`,
        "api_error",
        {
          "x-request-id": params.requestId,
          "x-soulswitch-agent-id": params.profile.agentId,
        },
      );
    } finally {
      clearTimeout(timeout);
    }
  };

  const listModels = async (params?: { allowedAgentIds?: string[]; requestId?: string }): Promise<Response> => {
    const allowedAgentIds = params?.allowedAgentIds;
    const allAgentIds = await listAgentIds(workspaceDir, agentsDir);
    const agentIds =
      Array.isArray(allowedAgentIds) && allowedAgentIds.length > 0
        ? allAgentIds.filter((agentId) => allowedAgentIds.includes(agentId))
        : allAgentIds;
    const rows = await Promise.all(
      agentIds.map(async (agentId) => {
        try {
          const profile = await resolveProfile(agentId);
          return {
            id: `agent:${agentId}`,
            object: "model",
            owned_by: "soulSwitch",
            ...(profile.modelId ? { root: profile.modelId } : {}),
          };
        } catch {
          return null;
        }
      }),
    );
    return new Response(
      JSON.stringify({
        object: "list",
        data: rows.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)),
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
          ...(params?.requestId ? { "x-request-id": params.requestId } : {}),
        },
      },
    );
  };

  const getModel = async (params: { modelId: string; allowedAgentIds?: string[]; requestId?: string }): Promise<Response> => {
    const list = await listModels({
      ...(params.allowedAgentIds ? { allowedAgentIds: params.allowedAgentIds } : {}),
      ...(params.requestId ? { requestId: params.requestId } : {}),
    });
    const payload = (await list.json()) as {
      data?: Array<{ id?: string; object?: string; owned_by?: string; root?: string }>;
    };
    const model = (payload.data ?? []).find((entry) => entry.id === params.modelId);
    if (!model) {
      return openAIError(404, `Model not found: ${params.modelId}`, "invalid_request_error", {
        ...(params.requestId ? { "x-request-id": params.requestId } : {}),
      });
    }
    return new Response(JSON.stringify(model), {
      status: 200,
      headers: {
        "content-type": "application/json",
        ...(params.requestId ? { "x-request-id": params.requestId } : {}),
      },
    });
  };

  return {
    stats: (): OpenAIProxyStats => ({
      defaultAgentId,
      cacheEntries: cache.size,
      cacheTtlMs,
      totalHandledRequests: counters.totalHandledRequests,
      upstreamAttempts: counters.upstreamAttempts,
      upstreamResponses: counters.upstreamResponses,
      upstreamErrors: counters.upstreamErrors,
      upstream5xxResponses: counters.upstream5xxResponses,
    }),
    reload: async (agentId?: string): Promise<{ ok: boolean; cleared: number; agentId?: string }> => {
      if (agentId?.trim()) {
        const normalized = agentId.trim();
        const deleted = cache.delete(normalized);
        return {
          ok: true,
          cleared: deleted ? 1 : 0,
          agentId: normalized,
        };
      }
      const cleared = cache.size;
      cache.clear();
      return {
        ok: true,
        cleared,
      };
    },
    ready: async (): Promise<OpenAIProxyReadyState> => {
      try {
        await resolveProfile(defaultAgentId);
        return {
          ok: true,
          agentId: defaultAgentId,
        };
      } catch (error) {
        return {
          ok: false,
          agentId: defaultAgentId,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    handle: async (request: Request): Promise<Response> => {
      counters.totalHandledRequests += 1;
      const url = new URL(request.url);
      const requestId = request.headers.get("x-request-id")?.trim() || randomUUID();
      if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/v1/models") {
        const asHead = request.method === "HEAD";
        if (!options.inboundAuth) {
          const response = await listModels({ requestId });
          return asHead ? new Response(null, { status: response.status, headers: response.headers }) : response;
        }
        const token = readInboundToken(request);
        if (!token) {
          return openAIError(401, "Missing bearer token.", "authentication_error", {
            "x-request-id": requestId,
          });
        }
        const rule = options.inboundAuth[token];
        if (!rule) {
          return openAIError(403, "Invalid API token.", "authentication_error", {
            "x-request-id": requestId,
          });
        }
        const allowed = rule.allowedAgentIds ?? [rule.defaultAgentId];
        const response = await listModels({
          requestId,
          allowedAgentIds: allowed.map((entry) => entry.trim()).filter(Boolean),
        });
        return asHead ? new Response(null, { status: response.status, headers: response.headers }) : response;
      }
      if ((request.method === "GET" || request.method === "HEAD") && url.pathname.startsWith("/v1/models/")) {
        const asHead = request.method === "HEAD";
        const modelId = decodeURIComponent(url.pathname.slice("/v1/models/".length));
        if (!modelId.trim()) {
          return openAIError(404, "Model not found.", "invalid_request_error", {
            "x-request-id": requestId,
          });
        }
        if (!options.inboundAuth) {
          const response = await getModel({ modelId, requestId });
          return asHead ? new Response(null, { status: response.status, headers: response.headers }) : response;
        }
        const token = readInboundToken(request);
        if (!token) {
          return openAIError(401, "Missing bearer token.", "authentication_error", {
            "x-request-id": requestId,
          });
        }
        const rule = options.inboundAuth[token];
        if (!rule) {
          return openAIError(403, "Invalid API token.", "authentication_error", {
            "x-request-id": requestId,
          });
        }
        const allowed = rule.allowedAgentIds ?? [rule.defaultAgentId];
        const response = await getModel({
          modelId,
          requestId,
          allowedAgentIds: allowed.map((entry) => entry.trim()).filter(Boolean),
        });
        return asHead ? new Response(null, { status: response.status, headers: response.headers }) : response;
      }
      if (request.method !== "POST") {
        return openAIError(405, "Method not allowed.", "invalid_request_error", {
          "x-request-id": requestId,
        });
      }
      if (!isJsonContentType(request.headers.get("content-type"))) {
        return openAIError(415, "Unsupported media type. Use application/json.", "invalid_request_error", {
          "x-request-id": requestId,
        });
      }
      const rawBody = await request.text();
      let payload: Record<string, unknown>;
      try {
        payload = parseJsonBody(rawBody);
      } catch (error) {
        return openAIError(400, error instanceof Error ? error.message : "Invalid JSON body.");
      }
      const headerAgentId = extractRequestedAgentId(request);
      const modelAliasAgentId = allowModelAlias ? extractAgentIdFromModelAlias(payload) : undefined;
      if (!allowModelAlias && extractAgentIdFromModelAlias(payload)) {
        return openAIError(400, "model alias routing is disabled for this proxy.", "invalid_request_error", {
          "x-request-id": requestId,
        });
      }
      if (headerAgentId && modelAliasAgentId && headerAgentId !== modelAliasAgentId) {
        return openAIError(400, "x-agent-id conflicts with model alias agent.", "invalid_request_error", {
          "x-request-id": requestId,
        });
      }
      const requestedAgentId = headerAgentId ?? modelAliasAgentId ?? undefined;
      const resolvedAgentId = resolveAgentId(request, {
        ...(requestedAgentId ? { requestedAgentId } : {}),
        requestId,
      });
      if (resolvedAgentId instanceof Response) {
        return resolvedAgentId;
      }
      let profile: ResolvedAgentProfile;
      try {
        profile = await resolveProfile(resolvedAgentId);
      } catch (error) {
        return openAIError(
          404,
          error instanceof Error ? error.message : `Agent not found: ${resolvedAgentId}`,
          "invalid_request_error",
          {
            "x-request-id": requestId,
          },
        );
      }
      const payloadWithoutAgentModelAlias = allowModelAlias ? stripAgentModelAlias(payload) : payload;
      const injectedPrompt = composePrompt(platformPrompt, profile.prompt);
      if (url.pathname === "/v1/chat/completions") {
        const payloadError = validateChatCompletionsPayload(payloadWithoutAgentModelAlias);
        if (payloadError) {
          return openAIError(400, payloadError, "invalid_request_error", {
            "x-request-id": requestId,
          });
        }
        const withPersona = mergePersonaIntoChatMessages(injectedPrompt, payloadWithoutAgentModelAlias);
        return await proxyJson({
          endpoint: "/chat/completions",
          payload: withPersona,
          profile,
          requestId,
        });
      }
      if (url.pathname === "/v1/responses") {
        const payloadError = validateResponsesPayload(payloadWithoutAgentModelAlias);
        if (payloadError) {
          return openAIError(400, payloadError, "invalid_request_error", {
            "x-request-id": requestId,
          });
        }
        const withPersona = mergePersonaIntoResponsesInput(injectedPrompt, payloadWithoutAgentModelAlias);
        return await proxyJson({
          endpoint: "/responses",
          payload: withPersona,
          profile,
          requestId,
        });
      }
      if (url.pathname === "/v1/completions") {
        const payloadError = validateCompletionsPayload(payloadWithoutAgentModelAlias);
        if (payloadError) {
          return openAIError(400, payloadError, "invalid_request_error", {
            "x-request-id": requestId,
          });
        }
        const withPersona = mergePersonaIntoCompletionsPrompt(injectedPrompt, payloadWithoutAgentModelAlias);
        return await proxyJson({
          endpoint: "/completions",
          payload: withPersona,
          profile,
          requestId,
        });
      }
      if (url.pathname === "/v1/embeddings") {
        const payloadError = validateEmbeddingsPayload(payloadWithoutAgentModelAlias);
        if (payloadError) {
          return openAIError(400, payloadError, "invalid_request_error", {
            "x-request-id": requestId,
          });
        }
        return await proxyJson({
          endpoint: "/embeddings",
          payload: payloadWithoutAgentModelAlias,
          profile,
          requestId,
        });
      }
      return openAIError(404, `Unsupported endpoint: ${url.pathname}`, "invalid_request_error", {
        "x-request-id": requestId,
      });
    },
  };
}
