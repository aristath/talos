import { TalosError } from "../../errors.js";
import type { MediaUnderstandToolOptions, ToolDefinition } from "../../types.js";

function requireInput(args: Record<string, unknown>, field: string): string {
  const value = typeof args[field] === "string" ? String(args[field]).trim() : "";
  if (!value) {
    throw new TalosError({
      code: "TOOL_FAILED",
      message: `media tool requires a non-empty '${field}' string.`,
    });
  }
  return value;
}

function optionalPrompt(args: Record<string, unknown>): string | undefined {
  const value = typeof args.prompt === "string" ? args.prompt.trim() : "";
  return value || undefined;
}

function createMediaTool(baseName: string, fallbackDescription: string, options: MediaUnderstandToolOptions) {
  return {
    name: options.name ?? baseName,
    description: options.description ?? fallbackDescription,
    async run(args: Record<string, unknown>, context) {
      const input = requireInput(args, baseName === "pdf" ? "document" : "image");
      const prompt = optionalPrompt(args);
      const analyzed = await options.analyze({ input, ...(prompt ? { prompt } : {}), context });
      return {
        content: analyzed.text,
        ...(typeof analyzed.data !== "undefined" ? { data: analyzed.data } : {}),
      };
    },
  } satisfies ToolDefinition;
}

export function createImageTool(options: MediaUnderstandToolOptions): ToolDefinition {
  return createMediaTool("image", "Analyze an image input", options);
}

export function createPdfTool(options: MediaUnderstandToolOptions): ToolDefinition {
  return createMediaTool("pdf", "Analyze a PDF document", options);
}
