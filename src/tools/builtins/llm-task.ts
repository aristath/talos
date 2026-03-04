import { TalosError } from "../../errors.js";
import type { LlmTaskToolOptions, ToolDefinition } from "../../types.js";
import Ajv2020 from "ajv/dist/2020.js";
import type { ErrorObject } from "ajv";

function requiredPrompt(args: Record<string, unknown>): string {
  const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
  if (!prompt) {
    throw new TalosError({
      code: "TOOL_FAILED",
      message: "llm_task requires a non-empty 'prompt' string.",
    });
  }
  return prompt;
}

function stripCodeFences(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (!match) {
    return trimmed;
  }
  return (match[1] ?? "").trim();
}

function toPositiveNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return value;
}

function toNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized || undefined;
}

export function createLlmTaskTool(options: LlmTaskToolOptions): ToolDefinition {
  const ajv = new Ajv2020.default({ allErrors: true, strict: false });
  return {
    name: options.name ?? "llm_task",
    description: options.description ?? "Run a JSON-only LLM task step",
    async run(args, context) {
      const prompt = requiredPrompt(args);
      const providerId = toNonEmptyString(args.providerId);
      const modelId = toNonEmptyString(args.modelId);
      const authProfileId = toNonEmptyString(args.authProfileId);
      const temperature = toPositiveNumber(args.temperature);
      const maxTokens = toPositiveNumber(args.maxTokens);
      const timeoutMs = toPositiveNumber(args.timeoutMs);
      const responseText = await options.generate({
        prompt,
        ...(Object.hasOwn(args, "input") ? { input: args.input } : {}),
        ...(Object.hasOwn(args, "schema") ? { schema: args.schema } : {}),
        ...(providerId ? { providerId } : {}),
        ...(modelId ? { modelId } : {}),
        ...(authProfileId ? { authProfileId } : {}),
        ...(temperature ? { temperature } : {}),
        ...(maxTokens ? { maxTokens } : {}),
        ...(timeoutMs ? { timeoutMs } : {}),
        context,
      });
      const raw = stripCodeFences(responseText);

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        throw new TalosError({
          code: "TOOL_FAILED",
          message: "llm_task response is not valid JSON.",
          cause: error,
          details: {
            responseText: raw,
          },
        });
      }

      if (options.validateJson) {
        const validation = options.validateJson(parsed, args.schema);
        if (!validation.ok) {
          throw new TalosError({
            code: "TOOL_FAILED",
            message: "llm_task JSON response failed schema validation.",
            details: {
              errors: validation.errors ?? [],
              response: parsed,
            },
          });
        }
      } else if (args.schema && typeof args.schema === "object" && !Array.isArray(args.schema)) {
        let valid = false;
        let errors: string[] = [];
        try {
          const validate = ajv.compile(args.schema as object);
          valid = Boolean(validate(parsed));
          if (!valid && validate.errors) {
            errors = validate.errors.map((entry: ErrorObject) => {
              return `${entry.instancePath || "<root>"} ${entry.message || "invalid"}`;
            });
          }
        } catch (error) {
          throw new TalosError({
            code: "TOOL_FAILED",
            message: "llm_task schema compilation failed.",
            cause: error,
          });
        }
        if (!valid) {
          throw new TalosError({
            code: "TOOL_FAILED",
            message: "llm_task JSON response failed schema validation.",
            details: {
              errors,
              response: parsed,
            },
          });
        }
      }

      return {
        content: JSON.stringify(parsed, null, 2),
        data: parsed,
      };
    },
  };
}
