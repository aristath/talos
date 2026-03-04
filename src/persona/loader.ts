import fs from "node:fs/promises";
import syncFs from "node:fs";
import path from "node:path";
import { TalosError } from "../errors.js";
import type {
  PersonaBootstrapFile,
  PersonaContextMode,
  PersonaFileName,
  PersonaLoadDiagnostic,
  PersonaLoadDiagnosticCode,
  PersonaRunKind,
  PersonaSessionKind,
  PersonaSnapshot,
} from "./types.js";
import { MINIMAL_PERSONA_ALLOWLIST, PERSONA_LOAD_ORDER } from "./templates.js";

const VALID_PERSONA_NAMES: ReadonlySet<string> = new Set(PERSONA_LOAD_ORDER);
const SKIP_MISSING_PERSONA_FILE_SET: ReadonlySet<string> = new Set(["MEMORY.md", "memory.md"]);
const MAX_PERSONA_FILE_BYTES = 2 * 1024 * 1024;
const DEFAULT_BOOTSTRAP_MAX_CHARS = 20_000;
const DEFAULT_BOOTSTRAP_TOTAL_MAX_CHARS = 150_000;
const MIN_BOOTSTRAP_FILE_BUDGET_CHARS = 64;
const BOOTSTRAP_HEAD_RATIO = 0.7;
const BOOTSTRAP_TAIL_RATIO = 0.2;

function truncateUtf16Safe(content: string, maxChars: number): string {
  if (maxChars <= 0) {
    return "";
  }
  if (content.length <= maxChars) {
    return content;
  }
  let sliced = content.slice(0, maxChars);
  const last = sliced.charCodeAt(sliced.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) {
    sliced = sliced.slice(0, -1);
  }
  return sliced;
}

function takeTailUtf16Safe(content: string, maxChars: number): string {
  if (maxChars <= 0) {
    return "";
  }
  if (content.length <= maxChars) {
    return content;
  }
  let sliced = content.slice(-maxChars);
  if (sliced.length === 0) {
    return sliced;
  }
  const first = sliced.charCodeAt(0);
  if (first >= 0xdc00 && first <= 0xdfff) {
    sliced = sliced.slice(1);
  }
  return sliced;
}

function sameFileIdentity(
  left: { dev: number | bigint; ino: number | bigint },
  right: { dev: number | bigint; ino: number | bigint },
): boolean {
  if (left.ino !== right.ino) {
    return false;
  }
  if (left.dev === right.dev) {
    return true;
  }
  const leftDevUnknown = left.dev === 0 || left.dev === 0n;
  const rightDevUnknown = right.dev === 0 || right.dev === 0n;
  return process.platform === "win32" && (leftDevUnknown || rightDevUnknown);
}

function isWithinRoot(root: string, candidate: string): boolean {
  if (candidate === root) {
    return true;
  }
  return candidate.startsWith(`${root}${path.sep}`);
}

async function readSafePersonaFile(params: {
  workspaceRealPath: string;
  filePath: string;
  fileName: PersonaFileName;
}): Promise<{
  file: PersonaBootstrapFile;
  reason?: PersonaLoadDiagnosticCode;
  detail?: string;
}> {
  const candidatePath = path.resolve(params.filePath);
  let stat;
  try {
    stat = await fs.lstat(candidatePath);
  } catch {
    return {
      file: {
        name: params.fileName,
        path: candidatePath,
        missing: true,
      },
      reason: "missing",
      detail: "missing",
    };
  }

  if (stat.isSymbolicLink()) {
    return {
      file: {
        name: params.fileName,
        path: candidatePath,
        missing: true,
      },
      reason: "security",
      detail: `Persona file cannot be a symlink: ${params.fileName}`,
    };
  }

  if (!stat.isFile()) {
    return {
      file: {
        name: params.fileName,
        path: candidatePath,
        missing: true,
      },
      reason: "missing",
      detail: "missing",
    };
  }

  let candidateRealPath = "";
  try {
    candidateRealPath = await fs.realpath(candidatePath);
  } catch (error) {
    return {
      file: {
        name: params.fileName,
        path: candidatePath,
        missing: true,
      },
      reason: "io",
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  if (!isWithinRoot(params.workspaceRealPath, candidateRealPath)) {
    return {
      file: {
        name: params.fileName,
        path: candidatePath,
        missing: true,
      },
      reason: "security",
      detail: `Persona file escapes workspace boundary: ${params.fileName}`,
    };
  }

  let preOpenStat;
  try {
    preOpenStat = await fs.lstat(candidateRealPath);
  } catch (error) {
    return {
      file: {
        name: params.fileName,
        path: candidatePath,
        missing: true,
      },
      reason: "io",
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  if (!preOpenStat.isFile()) {
    return {
      file: {
        name: params.fileName,
        path: candidatePath,
        missing: true,
      },
      reason: "missing",
      detail: "missing",
    };
  }
  if (preOpenStat.nlink > 1) {
    return {
      file: {
        name: params.fileName,
        path: candidatePath,
        missing: true,
      },
      reason: "security",
      detail: `Persona file cannot be hard-linked: ${params.fileName}`,
    };
  }
  if (preOpenStat.size > MAX_PERSONA_FILE_BYTES) {
    return {
      file: {
        name: params.fileName,
        path: candidatePath,
        missing: true,
      },
      reason: "security",
      detail: `Persona file exceeds max size (${MAX_PERSONA_FILE_BYTES} bytes): ${params.fileName}`,
    };
  }

  const openFlags =
    syncFs.constants.O_RDONLY |
    (typeof syncFs.constants.O_NOFOLLOW === "number" ? syncFs.constants.O_NOFOLLOW : 0);
  let handle;
  try {
    handle = await fs.open(candidateRealPath, openFlags);
  } catch (error) {
    return {
      file: {
        name: params.fileName,
        path: candidatePath,
        missing: true,
      },
      reason: "io",
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  let content = "";
  try {
    const openedStat = await handle.stat();
    if (!openedStat.isFile()) {
      return {
        file: {
          name: params.fileName,
          path: candidatePath,
          missing: true,
        },
        reason: "security",
        detail: `Persona file is not a regular file: ${params.fileName}`,
      };
    }
    if (openedStat.nlink > 1) {
      return {
        file: {
          name: params.fileName,
          path: candidatePath,
          missing: true,
        },
        reason: "security",
        detail: `Persona file cannot be hard-linked: ${params.fileName}`,
      };
    }
    if (openedStat.size > MAX_PERSONA_FILE_BYTES) {
      return {
        file: {
          name: params.fileName,
          path: candidatePath,
          missing: true,
        },
        reason: "security",
        detail: `Persona file exceeds max size (${MAX_PERSONA_FILE_BYTES} bytes): ${params.fileName}`,
      };
    }
    if (!sameFileIdentity(preOpenStat, openedStat)) {
      return {
        file: {
          name: params.fileName,
          path: candidatePath,
          missing: true,
        },
        reason: "security",
        detail: `Persona file changed while opening: ${params.fileName}`,
      };
    }
    content = await handle.readFile({ encoding: "utf8" });
  } catch (error) {
    return {
      file: {
        name: params.fileName,
        path: candidatePath,
        missing: true,
      },
      reason: "io",
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await handle.close();
  }

  return {
    file: {
      name: params.fileName,
      path: candidatePath,
      content,
      missing: false,
    },
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

export function filterPersonaFilesForContextMode(params: {
  files: PersonaBootstrapFile[];
  contextMode?: PersonaContextMode;
  runKind?: PersonaRunKind;
}): PersonaBootstrapFile[] {
  const contextMode = params.contextMode ?? "full";
  const runKind = params.runKind ?? "default";
  if (contextMode !== "lightweight") {
    return params.files;
  }
  if (runKind === "heartbeat") {
    return params.files.filter((file) => file.name === "HEARTBEAT.md");
  }
  return [];
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
        filePath: absolutePath,
        fileName: name,
      });
      if (loaded.file.missing) {
        diagnostics.push({
          path: absolutePath,
          reason: loaded.reason ?? "missing",
          detail: loaded.detail ?? "missing",
        });
        continue;
      }
      files.push(loaded.file);
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
      filePath: path.join(normalizedWorkspace, name),
      fileName: name,
    });
    if (loaded.file.missing && SKIP_MISSING_PERSONA_FILE_SET.has(name)) {
      continue;
    }
    loadedFiles.push(loaded.file);
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

export function buildPersonaSystemPrompt(
  snapshot?: PersonaSnapshot,
  options?: {
    bootstrapMaxChars?: number;
    bootstrapTotalMaxChars?: number;
  },
): string | undefined {
  if (!snapshot) {
    return undefined;
  }

  const trimContent = (content: string, fileName: string, maxChars: number) => {
    const trimmed = content.trimEnd();
    if (trimmed.length <= maxChars) {
      return trimmed;
    }
    const headChars = Math.floor(maxChars * BOOTSTRAP_HEAD_RATIO);
    const tailChars = Math.floor(maxChars * BOOTSTRAP_TAIL_RATIO);
    const head = truncateUtf16Safe(trimmed, headChars);
    const tail = takeTailUtf16Safe(trimmed, tailChars);
    const marker = [
      "",
      `[...truncated, read ${fileName} for full content...]`,
      `…(truncated ${fileName}: kept ${headChars}+${tailChars} chars of ${trimmed.length})…`,
      "",
    ].join("\n");
    return [head, marker, tail].join("\n");
  };

  const clampToBudget = (content: string, budget: number) => {
    if (budget <= 0) {
      return "";
    }
    if (content.length <= budget) {
      return content;
    }
    if (budget <= 1) {
      return truncateUtf16Safe(content, budget);
    }
    return `${truncateUtf16Safe(content, budget - 1)}…`;
  };

  const maxChars =
    typeof options?.bootstrapMaxChars === "number" && options.bootstrapMaxChars > 0
      ? Math.floor(options.bootstrapMaxChars)
      : DEFAULT_BOOTSTRAP_MAX_CHARS;
  const totalMaxChars =
    typeof options?.bootstrapTotalMaxChars === "number" && options.bootstrapTotalMaxChars > 0
      ? Math.floor(options.bootstrapTotalMaxChars)
      : DEFAULT_BOOTSTRAP_TOTAL_MAX_CHARS;
  let remaining = totalMaxChars;

  const sections: string[] = [];
  for (const file of snapshot.bootstrapFiles) {
    if (remaining <= 0) {
      break;
    }

    if (file.missing) {
      const missingText = clampToBudget(`[MISSING] Expected at: ${file.path}`, remaining);
      if (!missingText) {
        break;
      }
      remaining = Math.max(0, remaining - missingText.length);
      sections.push(`## ${file.name}\n${missingText}`);
      continue;
    }

    if (!file.content) {
      continue;
    }

    if (remaining < MIN_BOOTSTRAP_FILE_BUDGET_CHARS) {
      break;
    }

    const perFileBudget = Math.max(1, Math.min(maxChars, remaining));
    const trimmed = trimContent(file.content, file.name, perFileBudget);
    const capped = clampToBudget(trimmed, remaining);
    if (!capped) {
      continue;
    }
    remaining = Math.max(0, remaining - capped.length);
    sections.push(`## ${file.name}\n${capped}`);
  }

  if (sections.length === 0) {
    return undefined;
  }

  return ["Use this workspace persona context when answering:", ...sections].join("\n\n");
}
