import { describe, expect, it } from "vitest";
import { createSessionTools } from "./sessions.js";

describe("createSessionTools", () => {
  it("filters tool messages unless includeTools is true", async () => {
    const tools = createSessionTools({
      callbacks: {
        listSessions: () => [
          {
            sessionId: "agent:main:subagent:abc",
            agentId: "main",
            kind: "subagent",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            messages: [
              { role: "user", text: "u", at: "2026-01-01T00:00:00.000Z" },
              { role: "tool", text: "t", at: "2026-01-01T00:00:01.000Z" },
              { role: "assistant", text: "a", at: "2026-01-01T00:00:02.000Z" },
            ],
          },
        ],
        getHistory: () => [
          { role: "user", text: "u", at: "2026-01-01T00:00:00.000Z" },
          { role: "tool", text: "t", at: "2026-01-01T00:00:01.000Z" },
          { role: "assistant", text: "a", at: "2026-01-01T00:00:02.000Z" },
        ],
        sendToSession: async () => ({ runId: "r", text: "ok", providerId: "p", modelId: "m" }),
        spawnSession: async () => ({
          sessionId: "agent:main:subagent:xyz",
          runId: "r2",
          text: "ok",
          providerId: "p",
          modelId: "m",
        }),
        getStatus: () => undefined,
      },
    });

    const listTool = tools.find((tool) => tool.name === "sessions_list");
    const historyTool = tools.find((tool) => tool.name === "sessions_history");
    expect(listTool).toBeTruthy();
    expect(historyTool).toBeTruthy();

    const listResult = await listTool!.run({ messageLimit: 10 }, { agentId: "main" });
    const listMessages = (listResult.data as { sessions: Array<{ messages?: Array<{ role: string }> }> }).sessions[0]
      ?.messages;
    expect(listMessages?.some((entry) => entry.role === "tool")).toBe(false);

    const historyResult = await historyTool!.run(
      { sessionId: "agent:main:subagent:abc" },
      { agentId: "main" },
    );
    const historyMessages = (historyResult.data as { messages: Array<{ role: string }> }).messages;
    expect(historyMessages.some((entry) => entry.role === "tool")).toBe(false);

    const historyWithTools = await historyTool!.run(
      { sessionId: "agent:main:subagent:abc", includeTools: true },
      { agentId: "main" },
    );
    const historyWithToolsMessages = (historyWithTools.data as { messages: Array<{ role: string }> }).messages;
    expect(historyWithToolsMessages.some((entry) => entry.role === "tool")).toBe(true);
  });

  it("supports kinds and spawnedBy filters in sessions_list", async () => {
    const tools = createSessionTools({
      callbacks: {
        listSessions: () => [
          {
            sessionId: "agent:main:cron:daily",
            agentId: "main",
            kind: "cron",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            spawnedBy: "parent-a",
            messages: [],
          },
          {
            sessionId: "agent:main:subagent:abc",
            agentId: "main",
            kind: "subagent",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            spawnedBy: "parent-b",
            messages: [],
          },
        ],
        getHistory: () => [],
        sendToSession: async () => ({ runId: "r", text: "ok", providerId: "p", modelId: "m" }),
        spawnSession: async () => ({
          sessionId: "agent:main:subagent:xyz",
          runId: "r2",
          text: "ok",
          providerId: "p",
          modelId: "m",
        }),
        getStatus: () => undefined,
      },
    });

    const listTool = tools.find((tool) => tool.name === "sessions_list");
    expect(listTool).toBeTruthy();

    const cronOnly = await listTool!.run({ kinds: ["cron"] }, { agentId: "main" });
    const cronSessions = (cronOnly.data as { sessions: Array<{ sessionId: string }> }).sessions;
    expect(cronSessions).toHaveLength(1);
    expect(cronSessions[0]?.sessionId).toContain(":cron:");

    const spawnedBy = await listTool!.run({ spawnedBy: "parent-b" }, { agentId: "main" });
    const spawnedSessions = (spawnedBy.data as { sessions: Array<{ sessionId: string }> }).sessions;
    expect(spawnedSessions).toHaveLength(1);
    expect(spawnedSessions[0]?.sessionId).toContain(":subagent:");
  });
});
