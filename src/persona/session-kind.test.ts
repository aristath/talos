import { describe, expect, it } from "vitest";
import { resolvePersonaSessionKind } from "./session-kind.js";

describe("resolvePersonaSessionKind", () => {
  it("honors explicit sessionKind over sessionId", () => {
    expect(resolvePersonaSessionKind({ sessionKind: "main", sessionId: "agent:x:cron:daily" })).toBe(
      "main",
    );
  });

  it("detects canonical cron and subagent agent keys", () => {
    expect(resolvePersonaSessionKind({ sessionId: "agent:main:cron:daily" })).toBe("cron");
    expect(resolvePersonaSessionKind({ sessionId: "agent:main:subagent:child" })).toBe("subagent");
  });

  it("does not misclassify non-canonical session ids", () => {
    expect(resolvePersonaSessionKind({ sessionId: "my-cron-job" })).toBe("main");
    expect(resolvePersonaSessionKind({ sessionId: "agent:main:foo:subagent-like" })).toBe("main");
  });
});
