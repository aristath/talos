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

function collectInputs(args: Record<string, unknown>, singleField: string, multiField: string): string[] {
  const items: string[] = [];
  if (typeof args[singleField] === "string") {
    items.push(String(args[singleField]));
  }
  if (Array.isArray(args[multiField])) {
    items.push(
      ...args[multiField]
        .filter((item): item is string => typeof item === "string")
        .map((item) => item),
    );
  }
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const item of items) {
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    deduped.push(trimmed);
  }
  return deduped;
}

function toPositiveNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return value;
}

function optionalPrompt(args: Record<string, unknown>): string | undefined {
  const value = typeof args.prompt === "string" ? args.prompt.trim() : "";
  return value || undefined;
}

function createMediaTool(baseName: string, fallbackDescription: string, options: MediaUnderstandToolOptions) {
  const isPdf = baseName === "pdf";
  const singleField = isPdf ? "pdf" : "image";
  const multiField = isPdf ? "pdfs" : "images";
  const maxItems = isPdf ? 10 : 20;
  return {
    name: options.name ?? baseName,
    description: options.description ?? fallbackDescription,
    async run(args: Record<string, unknown>, context) {
      const collected = collectInputs(args, singleField, multiField);
      const fallbackSingle = isPdf ? "document" : "image";
      const input = collected[0] ?? requireInput(args, fallbackSingle);
      if (collected.length > maxItems) {
        throw new TalosError({
          code: "TOOL_FAILED",
          message: `Too many ${isPdf ? "PDFs" : "images"}: ${collected.length} provided, maximum is ${maxItems}.`,
          details: {
            error: isPdf ? "too_many_pdfs" : "too_many_images",
            count: collected.length,
            max: maxItems,
          },
        });
      }
      const prompt = optionalPrompt(args);
      const model = typeof args.model === "string" && args.model.trim() ? args.model.trim() : undefined;
      const maxBytesMb = toPositiveNumber(args.maxBytesMb);
      const pages = isPdf && typeof args.pages === "string" && args.pages.trim() ? args.pages.trim() : undefined;
      const analyzed = await options.analyze({
        input,
        ...(collected.length > 0 ? { inputs: collected } : {}),
        ...(prompt ? { prompt } : {}),
        ...(model ? { model } : {}),
        ...(typeof maxBytesMb === "number" ? { maxBytesMb } : {}),
        ...(pages ? { pages } : {}),
        context,
      });
      return {
        content: analyzed.text,
        data:
          typeof analyzed.data !== "undefined"
            ? {
                result: analyzed.data,
                ...(collected.length > 0 ? { inputs: collected } : {}),
              }
            : {
                ...(collected.length > 0 ? { inputs: collected } : {}),
              },
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
