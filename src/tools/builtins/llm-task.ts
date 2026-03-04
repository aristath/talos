import { TalosError } from "../../errors.js";
import type { LlmTaskToolOptions, ToolDefinition } from "../../types.js";

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

export function createLlmTaskTool(options: LlmTaskToolOptions): ToolDefinition {
  return {
    name: options.name ?? "llm_task",
    description: options.description ?? "Run a JSON-only LLM task step",
    async run(args, context) {
      const prompt = requiredPrompt(args);
      const providerId = typeof args.providerId === "string" && args.providerId.trim()
        ? args.providerId.trim()
        : undefined;
      const modelId = typeof args.modelId === "string" && args.modelId.trim()
        ? args.modelId.trim()
        : undefined;
      const responseText = await options.generate({
        prompt,
        ...(providerId ? { providerId } : {}),
        ...(modelId ? { modelId } : {}),
        context,
      });

      let parsed: unknown;
      try {
        parsed = JSON.parse(responseText);
      } catch (error) {
        throw new TalosError({
          code: "TOOL_FAILED",
          message: "llm_task response is not valid JSON.",
          cause: error,
          details: {
            responseText,
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
      }

      return {
        content: JSON.stringify(parsed, null, 2),
        data: parsed,
      };
    },
  };
}
