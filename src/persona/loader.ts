import fs from "node:fs/promises";
import path from "node:path";
import type { PersonaFileName, PersonaSnapshot } from "./types.js";

const PERSONA_FILES: readonly PersonaFileName[] = ["AGENTS.md", "SOUL.md", "IDENTITY.md", "USER.md"];

export async function loadPersonaSnapshot(workspaceDir: string): Promise<PersonaSnapshot> {
  const files: Partial<Record<PersonaFileName, string>> = {};
  for (const name of PERSONA_FILES) {
    const filePath = path.join(workspaceDir, name);
    try {
      files[name] = await fs.readFile(filePath, "utf8");
    } catch {
      // Missing persona files are allowed.
    }
  }
  return { workspaceDir, files };
}

export function buildPersonaSystemPrompt(snapshot?: PersonaSnapshot): string | undefined {
  if (!snapshot) {
    return undefined;
  }
  const sections = Object.entries(snapshot.files)
    .map(([name, content]) => `## ${name}\n${content?.trim() ?? ""}`)
    .filter((entry) => entry.trim().length > 0);
  if (sections.length === 0) {
    return undefined;
  }
  return ["Use this workspace persona context when answering:", ...sections].join("\n\n");
}
