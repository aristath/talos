import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { TalosError } from "../errors.js";
import type { OpenAIProxyOptions } from "./openai-compatible-proxy.js";

const INBOUND_AUTH_ENTRY_SCHEMA = z.object({
  token: z.string().min(1),
  defaultAgentId: z.string().min(1),
  allowedAgentIds: z.array(z.string().min(1)).optional(),
});

const PROXY_CONFIG_FILE_SCHEMA = z.object({
  defaultAgentId: z.string().min(1),
  agentsDir: z.string().min(1).optional(),
  profileConfigFileName: z.string().min(1).optional(),
  upstreamTimeoutMs: z.number().int().positive().optional(),
  cacheTtlMs: z.number().int().positive().optional(),
  inboundAuth: z.array(INBOUND_AUTH_ENTRY_SCHEMA).optional(),
});

export async function loadOpenAIProxyOptionsFromFile(params: {
  workspaceDir: string;
  configPath?: string;
}): Promise<OpenAIProxyOptions> {
  const workspaceDir = params.workspaceDir.trim();
  if (!workspaceDir) {
    throw new TalosError({
      code: "CONFIG_INVALID",
      message: "workspaceDir is required.",
    });
  }
  const configPath = path.resolve(workspaceDir, params.configPath?.trim() || "proxy.json");
  const raw = await fs.readFile(configPath, "utf8").catch((error) => {
    throw new TalosError({
      code: "CONFIG_INVALID",
      message: `Unable to read proxy config: ${configPath}`,
      cause: error,
    });
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new TalosError({
      code: "CONFIG_INVALID",
      message: `Invalid proxy JSON: ${configPath}`,
      cause: error,
    });
  }
  const validated = PROXY_CONFIG_FILE_SCHEMA.safeParse(parsed);
  if (!validated.success) {
    throw new TalosError({
      code: "CONFIG_INVALID",
      message: `Invalid proxy config schema: ${configPath}`,
      details: {
        issues: validated.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    });
  }
  const data = validated.data;
  const inboundAuth = data.inboundAuth
    ? Object.fromEntries(
        data.inboundAuth.map((entry) => [
          entry.token,
          {
            defaultAgentId: entry.defaultAgentId,
            ...(entry.allowedAgentIds ? { allowedAgentIds: entry.allowedAgentIds } : {}),
          },
        ]),
      )
    : undefined;
  return {
    workspaceDir,
    defaultAgentId: data.defaultAgentId,
    ...(data.agentsDir ? { agentsDir: data.agentsDir } : {}),
    ...(data.profileConfigFileName ? { profileConfigFileName: data.profileConfigFileName } : {}),
    ...(typeof data.upstreamTimeoutMs === "number" ? { upstreamTimeoutMs: data.upstreamTimeoutMs } : {}),
    ...(typeof data.cacheTtlMs === "number" ? { cacheTtlMs: data.cacheTtlMs } : {}),
    ...(inboundAuth ? { inboundAuth } : {}),
  };
}
