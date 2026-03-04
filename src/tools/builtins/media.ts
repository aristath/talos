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

function parsePagesExpression(raw: string, maxPages: number): number[] {
  const normalized = raw.trim();
  if (!normalized) {
    return [];
  }
  const pages = new Set<number>();
  const chunks = normalized.split(",").map((entry) => entry.trim()).filter(Boolean);
  for (const chunk of chunks) {
    const range = chunk.match(/^(\d+)-(\d+)$/);
    if (range) {
      const start = Number.parseInt(range[1] ?? "", 10);
      const end = Number.parseInt(range[2] ?? "", 10);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end <= 0 || end < start) {
        throw new TalosError({
          code: "TOOL_FAILED",
          message: `Invalid pages range: ${chunk}`,
        });
      }
      for (let page = start; page <= end; page += 1) {
        pages.add(page);
        if (pages.size >= maxPages) {
          break;
        }
      }
      continue;
    }

    if (!/^\d+$/.test(chunk)) {
      throw new TalosError({
        code: "TOOL_FAILED",
        message: `Invalid pages token: ${chunk}`,
      });
    }
    const page = Number.parseInt(chunk, 10);
    if (!Number.isFinite(page) || page <= 0) {
      throw new TalosError({
        code: "TOOL_FAILED",
        message: `Invalid page number: ${chunk}`,
      });
    }
    pages.add(page);
    if (pages.size >= maxPages) {
      break;
    }
  }

  return Array.from(pages).sort((a, b) => a - b);
}

function validateMediaReference(input: string, isPdf: boolean): void {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) {
    let parsed: URL;
    try {
      parsed = new URL(input);
    } catch {
      throw new TalosError({
        code: "TOOL_FAILED",
        message: `Invalid ${isPdf ? "PDF" : "image"} URL: ${input}`,
      });
    }
    const allowed = new Set(["http:", "https:", "file:"]);
    if (!allowed.has(parsed.protocol)) {
      throw new TalosError({
        code: "TOOL_FAILED",
        message: `Unsupported ${isPdf ? "PDF" : "image"} reference scheme: ${parsed.protocol}`,
        details: {
          error: isPdf ? "unsupported_pdf_reference" : "unsupported_image_reference",
          scheme: parsed.protocol,
        },
      });
    }
  }
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
  const maxPages = options.pdfMaxPages ?? 20;
  const defaultMaxBytesMb = isPdf ? (options.defaultPdfMaxBytesMb ?? 10) : 20;
  const nativePdfProviders = new Set((options.nativePdfProviders ?? ["anthropic", "google"]).map((v) => v.trim()));
  return {
    name: options.name ?? baseName,
    description: options.description ?? fallbackDescription,
    async run(args: Record<string, unknown>, context) {
      const collected = collectInputs(args, singleField, multiField);
      const fallbackSingle = isPdf ? "document" : "image";
      const input = collected[0] ?? requireInput(args, fallbackSingle);
      for (const reference of collected.length > 0 ? collected : [input]) {
        validateMediaReference(reference, isPdf);
      }
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
      const explicitModel = typeof args.model === "string" && args.model.trim() ? args.model.trim() : undefined;
      const candidateModels = [
        explicitModel,
        options.defaultModel,
        ...(options.modelFallbacks ?? []),
      ]
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean);
      const model = candidateModels[0];
      const requestedMaxBytesMb = toPositiveNumber(args.maxBytesMb);
      const maxBytesMb = requestedMaxBytesMb ?? defaultMaxBytesMb;
      const pagesRaw = isPdf && typeof args.pages === "string" && args.pages.trim() ? args.pages.trim() : undefined;
      const parsedPages = pagesRaw ? parsePagesExpression(pagesRaw, maxPages) : [];
      const pages = parsedPages.length > 0 ? parsedPages.join(",") : undefined;
      const modelProvider = model?.split("/")[0]?.trim();
      const nativePdfMode = Boolean(isPdf && modelProvider && nativePdfProviders.has(modelProvider));
      if (nativePdfMode && pages) {
        throw new TalosError({
          code: "TOOL_FAILED",
          message: "pages is not supported with native PDF providers",
        });
      }
      const attempts: Array<{ model?: string; error: string }> = [];
      let analyzed: Awaited<ReturnType<typeof options.analyze>> | undefined;
      const runAnalyze = async (candidateModel?: string) => {
        return await options.analyze({
          input,
          ...(collected.length > 0 ? { inputs: collected } : {}),
          ...(prompt ? { prompt } : {}),
          ...(candidateModel ? { model: candidateModel } : {}),
          ...(typeof maxBytesMb === "number" ? { maxBytesMb } : {}),
          ...(pages ? { pages } : {}),
          context,
        });
      };

      if (candidateModels.length > 0) {
        for (const candidateModel of candidateModels) {
          try {
            analyzed = await runAnalyze(candidateModel);
            break;
          } catch (error) {
            attempts.push({
              model: candidateModel,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      } else {
        analyzed = await runAnalyze(undefined);
      }

      if (!analyzed) {
        throw new TalosError({
          code: "TOOL_FAILED",
          message: `${baseName} analysis failed for all model attempts.`,
          details: {
            attempts,
          },
        });
      }

      return {
        content: analyzed.text,
        data:
          typeof analyzed.data !== "undefined"
            ? {
                result: analyzed.data,
                ...(collected.length > 0 ? { inputs: collected } : {}),
                details: {
                  ...(model ? { model } : {}),
                  attempts,
                  ...(isPdf ? { maxBytesMb, native: nativePdfMode, ...(pages ? { pages } : {}) } : {}),
                },
                ...(isPdf ? { maxBytesMb, native: nativePdfMode, ...(pages ? { pages } : {}) } : {}),
              }
            : {
                ...(collected.length > 0 ? { inputs: collected } : {}),
                details: {
                  ...(model ? { model } : {}),
                  attempts,
                  ...(isPdf ? { maxBytesMb, native: nativePdfMode, ...(pages ? { pages } : {}) } : {}),
                },
                ...(isPdf ? { maxBytesMb, native: nativePdfMode, ...(pages ? { pages } : {}) } : {}),
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
