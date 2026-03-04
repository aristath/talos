const DEFAULT_REDACT_KEYS = ["apikey", "authorization", "token", "password", "secret"];

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function redactValue(value: unknown, keys?: string[]): unknown {
  const normalizedKeys = new Set((keys ?? DEFAULT_REDACT_KEYS).map((key) => key.trim().toLowerCase()));

  const walk = (input: unknown): unknown => {
    if (Array.isArray(input)) {
      return input.map((entry) => walk(entry));
    }
    if (!isObject(input)) {
      return input;
    }
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(input)) {
      if (normalizedKeys.has(key.toLowerCase())) {
        out[key] = "[REDACTED]";
        continue;
      }
      out[key] = walk(raw);
    }
    return out;
  };

  return walk(value);
}
