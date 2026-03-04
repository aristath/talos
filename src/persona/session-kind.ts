import type { PersonaSessionKind } from "./types.js";

type ParsedAgentSessionKey = {
  agentId: string;
  rest: string;
};

function parseAgentSessionKey(sessionKey: string | undefined | null): ParsedAgentSessionKey | null {
  const raw = (sessionKey ?? "").trim().toLowerCase();
  if (!raw) {
    return null;
  }
  const parts = raw.split(":").filter(Boolean);
  if (parts.length < 3 || parts[0] !== "agent") {
    return null;
  }
  const agentId = parts[1]?.trim();
  const rest = parts.slice(2).join(":");
  if (!agentId || !rest) {
    return null;
  }
  return { agentId, rest };
}

function isCronSessionKey(sessionKey: string | undefined | null): boolean {
  const parsed = parseAgentSessionKey(sessionKey);
  if (!parsed) {
    return false;
  }
  return parsed.rest.toLowerCase().startsWith("cron:");
}

function isSubagentSessionKey(sessionKey: string | undefined | null): boolean {
  const raw = (sessionKey ?? "").trim();
  if (!raw) {
    return false;
  }
  if (raw.toLowerCase().startsWith("subagent:")) {
    return true;
  }
  const parsed = parseAgentSessionKey(raw);
  return Boolean((parsed?.rest ?? "").toLowerCase().startsWith("subagent:"));
}

export function resolvePersonaSessionKind(input: {
  sessionKind?: PersonaSessionKind;
  sessionId?: string;
}): PersonaSessionKind {
  if (input.sessionKind) {
    return input.sessionKind;
  }
  if (isCronSessionKey(input.sessionId)) {
    return "cron";
  }
  if (isSubagentSessionKey(input.sessionId)) {
    return "subagent";
  }
  return "main";
}
