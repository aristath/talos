import fs from "node:fs/promises";
import path from "node:path";
import { TalosError } from "../errors.js";
import type { PersonaFileName, PersonaSnapshot } from "./types.js";

const PERSONA_FILES: readonly PersonaFileName[] = ["AGENTS.md", "SOUL.md", "IDENTITY.md", "USER.md"];

function isWithinRoot(root: string, candidate: string): boolean {
  if (candidate === root) {
    return true;
  }
  return candidate.startsWith(`${root}${path.sep}`);
}

async function readSafePersonaFile(params: {
  workspaceRealPath: string;
  workspaceInputPath: string;
  fileName: PersonaFileName;
}): Promise<string | null> {
  const candidatePath = path.join(params.workspaceInputPath, params.fileName);
  let stat;
  try {
    stat = await fs.lstat(candidatePath);
  } catch {
    return null;
  }

  if (stat.isSymbolicLink()) {
    throw new TalosError({
      code: "PERSONA_FILE_UNSAFE",
      message: `Persona file cannot be a symlink: ${params.fileName}`,
    });
  }

  if (!stat.isFile()) {
    return null;
  }

  const candidateRealPath = await fs.realpath(candidatePath);
  if (!isWithinRoot(params.workspaceRealPath, candidateRealPath)) {
    throw new TalosError({
      code: "PERSONA_FILE_UNSAFE",
      message: `Persona file escapes workspace boundary: ${params.fileName}`,
    });
  }

  return await fs.readFile(candidatePath, "utf8");
}

export async function loadPersonaSnapshot(workspaceDir: string): Promise<PersonaSnapshot> {
  const normalizedWorkspace = workspaceDir.trim();
  if (!normalizedWorkspace) {
    throw new TalosError({
      code: "PERSONA_INVALID_WORKSPACE",
      message: "Workspace directory is required.",
    });
  }

  const workspaceRealPath = await fs.realpath(normalizedWorkspace).catch(() => null);
  if (!workspaceRealPath) {
    throw new TalosError({
      code: "PERSONA_INVALID_WORKSPACE",
      message: `Workspace directory does not exist: ${normalizedWorkspace}`,
    });
  }

  const workspaceStat = await fs.stat(workspaceRealPath);
  if (!workspaceStat.isDirectory()) {
    throw new TalosError({
      code: "PERSONA_INVALID_WORKSPACE",
      message: `Workspace path is not a directory: ${normalizedWorkspace}`,
    });
  }

  const files: Partial<Record<PersonaFileName, string>> = {};
  for (const name of PERSONA_FILES) {
    const content = await readSafePersonaFile({
      workspaceRealPath,
      workspaceInputPath: normalizedWorkspace,
      fileName: name,
    });
    if (content !== null) {
      files[name] = content;
    }
  }
  return { workspaceDir: workspaceRealPath, files };
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
