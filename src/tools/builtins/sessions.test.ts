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
    expect((listResult.data as { count?: number }).count).toBe(1);

    const historyResult = await historyTool!.run(
      { sessionId: "agent:main:subagent:abc" },
      { agentId: "main" },
    );
    const historyMessages = (historyResult.data as { messages: Array<{ role: string }> }).messages;
    expect(historyMessages.some((entry) => entry.role === "tool")).toBe(false);
    expect((historyResult.data as { count?: number }).count).toBe(2);

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

  it("enforces canAccessSession guard across list/history/send/status", async () => {
    const tools = createSessionTools({
      canAccessSession: ({ session }) => session.sessionId === "agent:main:subagent:allowed",
      callbacks: {
        listSessions: () => [
          {
            sessionId: "agent:main:subagent:allowed",
            agentId: "main",
            kind: "subagent",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            messages: [],
          },
          {
            sessionId: "agent:main:subagent:blocked",
            agentId: "main",
            kind: "subagent",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            messages: [],
          },
        ],
        getHistory: () => [],
        sendToSession: async () => ({ runId: "r", text: "ok", providerId: "p", modelId: "m" }),
        spawnSession: async () => ({
          sessionId: "agent:main:subagent:new",
          runId: "r2",
          text: "ok",
          providerId: "p",
          modelId: "m",
        }),
        getStatus: (sessionId) => {
          if (sessionId === "agent:main:subagent:blocked") {
            return {
              sessionId,
              agentId: "main",
              kind: "subagent",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
              messages: [],
            };
          }
          return {
            sessionId: "agent:main:subagent:allowed",
            agentId: "main",
            kind: "subagent",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            messages: [],
          };
        },
      },
    });

    const listTool = tools.find((tool) => tool.name === "sessions_list");
    const historyTool = tools.find((tool) => tool.name === "sessions_history");
    const sendTool = tools.find((tool) => tool.name === "sessions_send");
    const spawnTool = tools.find((tool) => tool.name === "sessions_spawn");
    const statusTool = tools.find((tool) => tool.name === "session_status");
    expect(listTool && historyTool && sendTool && spawnTool && statusTool).toBeTruthy();

    const listed = await listTool!.run({}, { agentId: "main", sessionId: "agent:main:main" });
    const sessions = (listed.data as { sessions: Array<{ sessionId: string }> }).sessions;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.sessionId).toBe("agent:main:subagent:allowed");

    await expect(
      historyTool!.run({ sessionId: "agent:main:subagent:blocked" }, { agentId: "main" }),
    ).rejects.toMatchObject({ code: "TOOL_NOT_ALLOWED" });
    await expect(
      sendTool!.run({ sessionId: "agent:main:subagent:blocked", message: "hi" }, { agentId: "main" }),
    ).rejects.toMatchObject({ code: "TOOL_NOT_ALLOWED" });
    await expect(
      statusTool!.run({ sessionId: "agent:main:subagent:blocked" }, { agentId: "main" }),
    ).rejects.toMatchObject({ code: "TOOL_NOT_ALLOWED" });
    await expect(
      spawnTool!.run(
        { task: "spawn" },
        { agentId: "main", sessionId: "agent:main:subagent:blocked" },
      ),
    ).rejects.toMatchObject({ code: "TOOL_NOT_ALLOWED" });
  });

  it("sanitizes, redacts, and caps sessions_history output", async () => {
    const largeText = `token=sk-abcdefghijklmnopqrstuvwxyz1234567890 ${"x".repeat(4500)}`;
    const tools = createSessionTools({
      callbacks: {
        listSessions: () => [],
        getHistory: () => [
          {
            role: "assistant",
            text: largeText,
            at: "2026-01-01T00:00:00.000Z",
          },
        ],
        sendToSession: async () => ({ runId: "r", text: "ok", providerId: "p", modelId: "m" }),
        spawnSession: async () => ({
          sessionId: "agent:main:subagent:xyz",
          runId: "r2",
          text: "ok",
          providerId: "p",
          modelId: "m",
        }),
        getStatus: () => ({
          sessionId: "agent:main:subagent:abc",
          agentId: "main",
          kind: "subagent",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          messages: [],
        }),
      },
    });

    const historyTool = tools.find((tool) => tool.name === "sessions_history");
    expect(historyTool).toBeTruthy();
    const result = await historyTool!.run({ sessionId: "agent:main:subagent:abc" }, { agentId: "main" });
    const data = result.data as {
      messages: Array<{ text: string }>;
      truncated: boolean;
      contentRedacted: boolean;
      bytes: number;
    };
    expect(data.messages[0]?.text).toContain("[REDACTED]");
    expect(data.messages[0]?.text).toContain("…(truncated)…");
    expect(data.truncated).toBe(true);
    expect(data.contentRedacted).toBe(true);
    expect(data.bytes).toBeGreaterThan(0);
  });

  it("supports sessions_send label lookup and status payload", async () => {
    const tools = createSessionTools({
      callbacks: {
        listSessions: () => [
          {
            sessionId: "agent:main:subagent:abc",
            agentId: "main",
            kind: "subagent",
            label: "planner",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            messages: [],
          },
        ],
        resolveSessionByLabel: ({ label }) => (label === "planner" ? "agent:main:subagent:abc" : undefined),
        getHistory: () => [],
        sendToSession: async () => ({
          runId: "run-1",
          status: "accepted",
          reply: "queued",
          delivery: {
            status: "pending",
            mode: "announce",
          },
        }),
        spawnSession: async () => ({
          sessionId: "agent:main:subagent:xyz",
          runId: "r2",
          text: "ok",
          providerId: "p",
          modelId: "m",
        }),
        getStatus: (sessionId) => ({
          sessionId,
          agentId: "main",
          kind: "subagent",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          messages: [],
        }),
      },
    });

    const sendTool = tools.find((tool) => tool.name === "sessions_send");
    expect(sendTool).toBeTruthy();
    const result = await sendTool!.run({ label: "planner", message: "hello" }, { agentId: "main" });
    const data = result.data as {
      sessionId?: string;
      status?: string;
      reply?: string;
      details?: { status?: string };
    };
    expect(data.sessionId).toBe("agent:main:subagent:abc");
    expect(data.status).toBe("accepted");
    expect(data.reply).toBe("queued");
    expect(data.details?.status).toBe("accepted");
  });
});
