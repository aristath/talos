import fs from "node:fs/promises";
import path from "node:path";
import { TalosError } from "../errors.js";
import type { PersonaFileName } from "./types.js";
import { DEFAULT_PERSONA_TEMPLATES } from "./templates.js";

export type PersonaBootstrapResult = {
  workspaceDir: string;
  created: PersonaFileName[];
  existing: PersonaFileName[];
};

export async function seedPersonaWorkspace(
  workspaceDir: string,
  options?: {
    overwrite?: boolean;
    templates?: Partial<Record<PersonaFileName, string>>;
  },
): Promise<PersonaBootstrapResult> {
  const normalized = workspaceDir.trim();
  if (!normalized) {
    throw new TalosError({
      code: "PERSONA_INVALID_WORKSPACE",
      message: "Workspace directory is required.",
    });
  }

  await fs.mkdir(normalized, { recursive: true });
  const realDir = await fs.realpath(normalized);
  const stat = await fs.stat(realDir);
  if (!stat.isDirectory()) {
    throw new TalosError({
      code: "PERSONA_INVALID_WORKSPACE",
      message: `Workspace path is not a directory: ${normalized}`,
    });
  }

  const templates = {
    ...DEFAULT_PERSONA_TEMPLATES,
    ...(options?.templates ?? {}),
  };

  const created: PersonaFileName[] = [];
  const existing: PersonaFileName[] = [];

  const names = Object.keys(DEFAULT_PERSONA_TEMPLATES) as PersonaFileName[];
  for (const name of names) {
    const targetPath = path.join(realDir, name);
    const payload = `${templates[name].trim()}\n`;
    if (options?.overwrite) {
      await fs.writeFile(targetPath, payload, "utf8");
      created.push(name);
      continue;
    }
    const exists = await fs
      .access(targetPath)
      .then(() => true)
      .catch(() => false);
    if (exists) {
      existing.push(name);
      continue;
    }
    await fs.writeFile(targetPath, payload, { encoding: "utf8", flag: "wx" });
    created.push(name);
  }

  return {
    workspaceDir: realDir,
    created,
    existing,
  };
}
