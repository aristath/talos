import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PersonaFileName } from "./types.js";
import { DEFAULT_PERSONA_TEMPLATES, PERSONA_LOAD_ORDER } from "./templates.js";

const DOCS_TEMPLATE_ENV = "TALOS_PERSONA_TEMPLATE_DIR";

function stripFrontmatter(raw: string): string {
  if (!raw.startsWith("---\n")) {
    return raw;
  }
  const end = raw.indexOf("\n---\n", 4);
  if (end === -1) {
    return raw;
  }
  return raw.slice(end + 5);
}

function resolveTemplateDir(): string {
  const envDir = process.env[DOCS_TEMPLATE_ENV]?.trim();
  if (envDir) {
    return path.resolve(envDir);
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../docs/reference/templates");
}

let cached: Readonly<Record<PersonaFileName, string>> | null = null;
let cachedDir: string | null = null;

export async function loadPersonaTemplates(options?: {
  forceReload?: boolean;
}): Promise<Readonly<Record<PersonaFileName, string>>> {
  const dir = resolveTemplateDir();
  if (cached && !options?.forceReload && cachedDir === dir) {
    return cached;
  }

  const next: Record<PersonaFileName, string> = {
    ...DEFAULT_PERSONA_TEMPLATES,
  };

  for (const name of PERSONA_LOAD_ORDER) {
    const filePath = path.join(dir, name);
    try {
      const raw = await fs.readFile(filePath, "utf8");
      next[name] = stripFrontmatter(raw);
    } catch {
      // Fallback to embedded defaults when docs templates are unavailable.
    }
  }

  cached = next;
  cachedDir = dir;
  return cached;
}
