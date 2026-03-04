import fs from "node:fs/promises";
import path from "node:path";
import { TalosError } from "../errors.js";
import type {
  PersonaBootstrapFile,
  PersonaFileName,
  PersonaLoadDiagnostic,
  PersonaLoadDiagnosticCode,
  PersonaSessionKind,
  PersonaSnapshot,
} from "./types.js";
import { MINIMAL_PERSONA_ALLOWLIST, PERSONA_LOAD_ORDER } from "./templates.js";

const VALID_PERSONA_NAMES: ReadonlySet<string> = new Set(PERSONA_LOAD_ORDER);

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
}): Promise<PersonaBootstrapFile> {
  const candidatePath = path.join(params.workspaceInputPath, params.fileName);
  let stat;
  try {
    stat = await fs.lstat(candidatePath);
  } catch {
    return {
      name: params.fileName,
      path: candidatePath,
      missing: true,
    };
  }

  if (stat.isSymbolicLink()) {
    throw new TalosError({
      code: "PERSONA_FILE_UNSAFE",
      message: `Persona file cannot be a symlink: ${params.fileName}`,
    });
  }

  if (!stat.isFile()) {
    return {
      name: params.fileName,
      path: candidatePath,
      missing: true,
    };
  }

  const candidateRealPath = await fs.realpath(candidatePath);
  if (!isWithinRoot(params.workspaceRealPath, candidateRealPath)) {
    throw new TalosError({
      code: "PERSONA_FILE_UNSAFE",
      message: `Persona file escapes workspace boundary: ${params.fileName}`,
    });
  }

  const content = await fs.readFile(candidatePath, "utf8");
  return {
    name: params.fileName,
    path: candidatePath,
    content,
    missing: false,
  };
}

export function filterPersonaFilesForSession(
  files: PersonaBootstrapFile[],
  sessionKind: PersonaSessionKind,
): PersonaBootstrapFile[] {
  if (sessionKind === "main") {
    return files;
  }
  return files.filter((file) => MINIMAL_PERSONA_ALLOWLIST.has(file.name));
}

export async function loadExtraPersonaFilesWithDiagnostics(params: {
  workspaceDir: string;
  extraPatterns: string[];
}): Promise<{
  files: PersonaBootstrapFile[];
  diagnostics: PersonaLoadDiagnostic[];
}> {
  if (params.extraPatterns.length === 0) {
    return { files: [], diagnostics: [] };
  }

  const resolvedDir = path.resolve(params.workspaceDir);
  const resolvedPaths = new Set<string>();

  for (const pattern of params.extraPatterns) {
    if (pattern.includes("*") || pattern.includes("?") || pattern.includes("{")) {
      try {
        const matches = fs.glob(pattern, { cwd: resolvedDir });
        for await (const match of matches) {
          resolvedPaths.add(match);
        }
      } catch {
        resolvedPaths.add(pattern);
      }
    } else {
      resolvedPaths.add(pattern);
    }
  }

  const diagnostics: PersonaLoadDiagnostic[] = [];
  const files: PersonaBootstrapFile[] = [];

  for (const relPath of resolvedPaths) {
    const absolutePath = path.resolve(resolvedDir, relPath);
    const baseName = path.basename(relPath);
    if (!VALID_PERSONA_NAMES.has(baseName)) {
      diagnostics.push({
        path: absolutePath,
        reason: "invalid-persona-filename",
        detail: `unsupported persona basename: ${baseName}`,
      });
      continue;
    }

    const name = baseName as PersonaFileName;
    try {
      const loaded = await readSafePersonaFile({
        workspaceRealPath: resolvedDir,
        workspaceInputPath: resolvedDir,
        fileName: name,
      });
      files.push(loaded);
      if (loaded.missing) {
        diagnostics.push({
          path: absolutePath,
          reason: "missing",
          detail: "missing",
        });
      }
    } catch (error) {
      const reason: PersonaLoadDiagnosticCode =
        error instanceof TalosError && error.code === "PERSONA_FILE_UNSAFE" ? "security" : "io";
      diagnostics.push({
        path: absolutePath,
        reason,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { files, diagnostics };
}

function resolveSessionKind(sessionKind?: PersonaSessionKind): PersonaSessionKind {
  return sessionKind ?? "main";
}

export async function loadPersonaSnapshot(
  workspaceDir: string,
  options?: {
    sessionKind?: PersonaSessionKind;
    extraPatterns?: string[];
  },
): Promise<PersonaSnapshot> {
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

  const loadedFiles: PersonaBootstrapFile[] = [];
  for (const name of PERSONA_LOAD_ORDER) {
    const loaded = await readSafePersonaFile({
      workspaceRealPath,
      workspaceInputPath: normalizedWorkspace,
      fileName: name,
    });
    loadedFiles.push(loaded);
  }

  const extra = await loadExtraPersonaFilesWithDiagnostics({
    workspaceDir: workspaceRealPath,
    extraPatterns: options?.extraPatterns ?? [],
  });

  const sessionKind = resolveSessionKind(options?.sessionKind);
  const bootstrapFiles = filterPersonaFilesForSession([...loadedFiles, ...extra.files], sessionKind);

  const files: Partial<Record<PersonaFileName, string>> = {};
  for (const file of bootstrapFiles) {
    if (!file.missing && typeof file.content === "string") {
      files[file.name] = file.content;
    }
  }

  return {
    workspaceDir: workspaceRealPath,
    sessionKind,
    files,
    bootstrapFiles,
    diagnostics: extra.diagnostics,
  };
}

export function buildPersonaSystemPrompt(snapshot?: PersonaSnapshot): string | undefined {
  if (!snapshot) {
    return undefined;
  }
  const sections = snapshot.bootstrapFiles
    .filter((file) => !file.missing && typeof file.content === "string")
    .map((file) => `## ${file.name}\n${file.content?.trim() ?? ""}`)
    .filter((entry) => entry.trim().length > 0);

  if (sections.length === 0) {
    return undefined;
  }

  return ["Use this workspace persona context when answering:", ...sections].join("\n\n");
}
