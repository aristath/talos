import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { SoulSwitchError } from "../errors.js";

const AGENT_AUTH_SCHEMA = z.object({
  type: z.literal("static").optional(),
  apiKey: z.string().min(1),
});

const AGENT_UPSTREAM_SCHEMA = z
  .object({
    providerId: z.string().min(1).optional(),
    provider: z.string().min(1).optional(),
    baseURL: z.string().url().optional(),
    baseUrl: z.string().url().optional(),
    headers: z.record(z.string()).optional(),
    auth: AGENT_AUTH_SCHEMA.optional(),
  })
  .optional();

const AGENT_MODEL_SCHEMA = z
  .object({
    default: z.string().min(1).optional(),
    fallbacks: z.array(z.string().min(1)).optional(),
  })
  .optional();

const AGENT_LIMITS_SCHEMA = z
  .object({
    timeoutMs: z.number().int().positive().optional(),
  })
  .optional();

const AGENT_JSON_SCHEMA = z
  .object({
    id: z.string().min(1).optional(),
    providerId: z.string().min(1).optional(),
    modelId: z.string().min(1).optional(),
    upstream: AGENT_UPSTREAM_SCHEMA,
    model: AGENT_MODEL_SCHEMA,
    limits: AGENT_LIMITS_SCHEMA,
  })
  .strict();

export type AgentRuntimeProfile = {
  personaDir: string;
  providerId?: string;
  modelId?: string;
  fallbackModelIds?: string[];
  timeoutMs?: number;
  baseUrl?: string;
  apiKey?: string;
  headers?: Record<string, string>;
};

function isWithinRoot(root: string, candidate: string): boolean {
  if (candidate === root) {
    return true;
  }
  return candidate.startsWith(`${root}${path.sep}`);
}

async function readAgentJson(filePath: string): Promise<z.infer<typeof AGENT_JSON_SCHEMA> | null> {
  let raw = "";
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new SoulSwitchError({
      code: "CONFIG_INVALID",
      message: `Invalid JSON in agent config: ${filePath}`,
      cause: error,
    });
  }
  const validated = AGENT_JSON_SCHEMA.safeParse(parsed);
  if (!validated.success) {
    throw new SoulSwitchError({
      code: "CONFIG_INVALID",
      message: `Invalid agent config schema: ${filePath}`,
      details: {
        issues: validated.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    });
  }
  return validated.data;
}

export async function loadAgentRuntimeProfile(params: {
  workspaceDir: string;
  agentId: string;
  agentsDir?: string;
  configFileName?: string;
}): Promise<AgentRuntimeProfile | null> {
  const normalizedWorkspace = params.workspaceDir.trim();
  if (!normalizedWorkspace) {
    return null;
  }
  const workspaceRealPath = await fs.realpath(normalizedWorkspace).catch(() => null);
  if (!workspaceRealPath) {
    return null;
  }
  const agentsDir = params.agentsDir?.trim() || "agents";
  const configFileName = params.configFileName?.trim() || "agent.json";
  const agentDir = path.join(workspaceRealPath, agentsDir, params.agentId.trim());
  const agentDirStat = await fs.stat(agentDir).catch(() => null);
  if (!agentDirStat?.isDirectory()) {
    return null;
  }
  const agentDirRealPath = await fs.realpath(agentDir);
  if (!isWithinRoot(workspaceRealPath, agentDirRealPath)) {
    throw new SoulSwitchError({
      code: "PERSONA_FILE_UNSAFE",
      message: `Agent persona directory escapes workspace boundary: ${params.agentId}`,
    });
  }
  const soulPath = path.join(agentDirRealPath, "SOUL.md");
  const soulStat = await fs.stat(soulPath).catch(() => null);
  if (!soulStat?.isFile()) {
    throw new SoulSwitchError({
      code: "CONFIG_INVALID",
      message: `Agent persona is missing required file: ${soulPath}`,
    });
  }
  const agentConfigPath = path.join(agentDirRealPath, configFileName);
  const agentConfig = await readAgentJson(agentConfigPath);
  const providerId =
    agentConfig?.upstream?.providerId ?? agentConfig?.upstream?.provider ?? agentConfig?.providerId;
  const modelId = agentConfig?.model?.default ?? agentConfig?.modelId;
  const fallbackModelIds = agentConfig?.model?.fallbacks?.map((entry) => entry.trim()).filter(Boolean);
  const timeoutMs = agentConfig?.limits?.timeoutMs;
  const baseUrl = agentConfig?.upstream?.baseURL ?? agentConfig?.upstream?.baseUrl;
  const apiKey = agentConfig?.upstream?.auth?.apiKey;
  const headers = agentConfig?.upstream?.headers;
  return {
    personaDir: agentDirRealPath,
    ...(providerId ? { providerId } : {}),
    ...(modelId ? { modelId } : {}),
    ...(fallbackModelIds && fallbackModelIds.length > 0 ? { fallbackModelIds } : {}),
    ...(typeof timeoutMs === "number" ? { timeoutMs } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(headers ? { headers } : {}),
  };
}
