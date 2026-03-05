import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadAgentRuntimeProfile } from "./agent-config.js";

describe("loadAgentRuntimeProfile", () => {
  it("loads per-agent persona profile and static auth", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "soulSwitch-agent-profile-"));
    const agentDir = path.join(workspace, "agents", "designer");
    await fs.mkdir(agentDir, { recursive: true });
    await fs.writeFile(path.join(agentDir, "SOUL.md"), "Designer soul", "utf8");
    await fs.writeFile(
      path.join(agentDir, "agent.json"),
      JSON.stringify(
        {
          upstream: {
            providerId: "openrouter",
            baseURL: "https://openrouter.ai/api/v1",
            headers: {
              "HTTP-Referer": "https://agency.example",
            },
            auth: {
              type: "static",
              apiKey: "sk-openrouter-123",
            },
          },
        model: {
          default: "openai/gpt-4.1",
          fallbacks: ["anthropic/claude-3-7-sonnet"],
        },
        limits: {
          timeoutMs: 12345,
        },
      },
        null,
        2,
      ),
      "utf8",
    );

    const profile = await loadAgentRuntimeProfile({
      workspaceDir: workspace,
      agentId: "designer",
    });

    expect(profile?.providerId).toBe("openrouter");
    expect(profile?.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(profile?.modelId).toBe("openai/gpt-4.1");
    expect(profile?.fallbackModelIds).toEqual(["anthropic/claude-3-7-sonnet"]);
    expect(profile?.timeoutMs).toBe(12345);
    expect(profile?.apiKey).toBe("sk-openrouter-123");
    expect(profile?.headers?.["HTTP-Referer"]).toBe("https://agency.example");
  });

  it("returns null when no agent directory exists", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "soulSwitch-agent-profile-"));
    const profile = await loadAgentRuntimeProfile({
      workspaceDir: workspace,
      agentId: "missing",
    });
    expect(profile).toBeNull();
  });
});
