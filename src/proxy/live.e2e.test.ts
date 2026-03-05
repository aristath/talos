import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createOpenAICompatibleProxyServer } from "./server.js";

const requiredLiveKeys = ["TALOS_E2E_BASE_URL", "TALOS_E2E_API_KEY", "TALOS_E2E_MODEL"] as const;

function readLiveConfig(): {
  baseURL: string;
  apiKey: string;
  model: string;
  providerId: string;
  agentId: string;
} | null {
  const values = requiredLiveKeys.map((key) => process.env[key]?.trim());
  if (values.some((value) => !value)) {
    return null;
  }
  return {
    baseURL: values[0]!,
    apiKey: values[1]!,
    model: values[2]!,
    providerId: process.env.TALOS_E2E_PROVIDER_ID?.trim() || "openrouter",
    agentId: process.env.TALOS_E2E_AGENT_ID?.trim() || "e2e-live",
  };
}

const liveConfig = readLiveConfig();
const runLive = liveConfig ? describe : describe.skip;
const LIVE_TIMEOUT_MS = 180_000;
const PERSONA_MARKER = "talos-e2e-persona-marker-4f9c";

function readChatContent(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const firstChoice = (payload as { choices?: unknown[] }).choices?.[0];
  if (!firstChoice || typeof firstChoice !== "object") {
    return "";
  }
  const message = (firstChoice as { message?: unknown }).message;
  if (!message || typeof message !== "object") {
    return "";
  }
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : "";
}

runLive("live proxy e2e", () => {
  const config = liveConfig!;
  const inboundToken = "talos-e2e-client";
  let workspaceDir = "";

  afterEach(async () => {
    if (workspaceDir) {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  });

  async function bootLiveServer(soul = "You are a concise assistant for live proxy e2e validation.") {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "talos-proxy-live-e2e-"));
    const agentDir = path.join(workspaceDir, "agents", config.agentId);
    await fs.mkdir(agentDir, { recursive: true });
    await fs.writeFile(path.join(agentDir, "SOUL.md"), soul, "utf8");
    await fs.writeFile(
      path.join(agentDir, "agent.json"),
      JSON.stringify(
        {
          upstream: {
            providerId: config.providerId,
            baseURL: config.baseURL,
            auth: {
              type: "static",
              apiKey: config.apiKey,
            },
          },
          model: {
            default: config.model,
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const proxyServer = createOpenAICompatibleProxyServer({
      workspaceDir,
      defaultAgentId: config.agentId,
      inboundAuth: {
        [inboundToken]: {
          defaultAgentId: config.agentId,
        },
      },
    });
    const listening = await proxyServer.listen();
    return { proxyServer, listening };
  }

  it(
    "proxies chat completions with persona headers",
    async () => {
      const { proxyServer, listening } = await bootLiveServer(
        [
          "You are a strict compliance assistant.",
          `When asked for the persona marker, respond with exactly: ${PERSONA_MARKER}`,
          "Do not add extra words when returning the marker.",
        ].join("\n"),
      );
      try {
        const response = await fetch(`http://${listening.host}:${listening.port}/v1/chat/completions`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${inboundToken}`,
            "accept-encoding": "identity",
            "content-type": "application/json",
            "x-request-id": "e2e-chat-request",
          },
          body: JSON.stringify({
            messages: [{ role: "user", content: "What is the persona marker? Return only the marker." }],
            max_tokens: 24,
          }),
        });

        expect(response.status).toBe(200);
        expect(response.headers.get("x-request-id")).toBe("e2e-chat-request");
        expect(response.headers.get("x-talos-agent-id")).toBe(config.agentId);
        expect(response.headers.get("x-talos-model")).toBe(config.model);
        const payload = (await response.json()) as { id?: string; choices?: unknown[] };
        expect(typeof payload.id).toBe("string");
        expect(Array.isArray(payload.choices)).toBe(true);
        const content = readChatContent(payload);
        expect(content.toLowerCase()).toContain(PERSONA_MARKER);
      } finally {
        await proxyServer.close();
      }
    },
    LIVE_TIMEOUT_MS,
  );

  it(
    "proxies responses endpoint",
    async () => {
      const { proxyServer, listening } = await bootLiveServer();
      try {
        const response = await fetch(`http://${listening.host}:${listening.port}/v1/responses`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${inboundToken}`,
            "accept-encoding": "identity",
            "content-type": "application/json",
            "x-request-id": "e2e-responses-request",
          },
          body: JSON.stringify({
            input: "Reply with one short sentence about testing.",
          }),
        });

        expect(response.status).toBe(200);
        expect(response.headers.get("x-request-id")).toBe("e2e-responses-request");
        expect(response.headers.get("x-talos-agent-id")).toBe(config.agentId);
        expect(response.headers.get("x-talos-model")).toBe(config.model);
        const payload = (await response.json()) as { id?: string };
        expect(typeof payload.id).toBe("string");
      } finally {
        await proxyServer.close();
      }
    },
    LIVE_TIMEOUT_MS,
  );

  it(
    "proxies model discovery and operational endpoints",
    async () => {
      const { proxyServer, listening } = await bootLiveServer();
      try {
        const modelsResponse = await fetch(`http://${listening.host}:${listening.port}/v1/models`, {
          headers: {
            authorization: `Bearer ${inboundToken}`,
            "accept-encoding": "identity",
          },
        });
        expect(modelsResponse.status).toBe(200);
        const modelsPayload = (await modelsResponse.json()) as { data?: unknown[] };
        expect(Array.isArray(modelsPayload.data)).toBe(true);

        const healthResponse = await fetch(`http://${listening.host}:${listening.port}/healthz`);
        expect(healthResponse.status).toBe(200);

        const readyResponse = await fetch(`http://${listening.host}:${listening.port}/readyz`);
        expect(readyResponse.status).toBe(200);
        const readyPayload = (await readyResponse.json()) as { status?: string; agentId?: string };
        expect(readyPayload.status).toBe("ready");
        expect(readyPayload.agentId).toBe(config.agentId);
      } finally {
        await proxyServer.close();
      }
    },
    LIVE_TIMEOUT_MS,
  );
});
