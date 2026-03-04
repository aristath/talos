import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { TalosError } from "../errors.js";
import type { PersonaFileName } from "./types.js";
import { DEFAULT_PERSONA_TEMPLATES, DEFAULT_SEEDED_PERSONA_FILES } from "./templates.js";

const STATE_DIRNAME = ".openclaw";
const STATE_FILENAME = "workspace-state.json";
const STATE_VERSION = 1;

type PersonaWorkspaceState = {
  version: number;
  bootstrapSeededAt?: string;
  onboardingCompletedAt?: string;
};

export type PersonaBootstrapResult = {
  workspaceDir: string;
  created: PersonaFileName[];
  existing: PersonaFileName[];
  bootstrapPath: string;
  statePath: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function resolveStatePath(workspaceDir: string): string {
  return path.join(workspaceDir, STATE_DIRNAME, STATE_FILENAME);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readState(statePath: string): Promise<PersonaWorkspaceState> {
  try {
    const raw = await fs.readFile(statePath, "utf8");
    const parsed = JSON.parse(raw) as PersonaWorkspaceState;
    return {
      version: STATE_VERSION,
      ...(typeof parsed.bootstrapSeededAt === "string"
        ? { bootstrapSeededAt: parsed.bootstrapSeededAt }
        : {}),
      ...(typeof parsed.onboardingCompletedAt === "string"
        ? { onboardingCompletedAt: parsed.onboardingCompletedAt }
        : {}),
    };
  } catch {
    return { version: STATE_VERSION };
  }
}

async function writeState(statePath: string, state: PersonaWorkspaceState): Promise<void> {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  const payload = `${JSON.stringify(state, null, 2)}\n`;
  const tmpPath = `${statePath}.tmp-${process.pid}-${randomUUID()}`;
  await fs.writeFile(tmpPath, payload, "utf8");
  await fs.rename(tmpPath, statePath);
}

async function writeFileIfMissing(filePath: string, content: string): Promise<boolean> {
  try {
    await fs.writeFile(filePath, content, { encoding: "utf8", flag: "wx" });
    return true;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "EEXIST") {
      return false;
    }
    throw error;
  }
}

async function shouldCreateBootstrap(params: {
  workspaceDir: string;
  identityPath: string;
  userPath: string;
}): Promise<boolean> {
  const [identityContent, userContent] = await Promise.all([
    fs.readFile(params.identityPath, "utf8").catch(() => ""),
    fs.readFile(params.userPath, "utf8").catch(() => ""),
  ]);

  const identityTemplate = DEFAULT_PERSONA_TEMPLATES["IDENTITY.md"];
  const userTemplate = DEFAULT_PERSONA_TEMPLATES["USER.md"];

  if (identityContent !== identityTemplate || userContent !== userTemplate) {
    return false;
  }

  const indicators = [
    path.join(params.workspaceDir, "memory"),
    path.join(params.workspaceDir, "MEMORY.md"),
    path.join(params.workspaceDir, ".git"),
  ];
  for (const indicator of indicators) {
    if (await fileExists(indicator)) {
      return false;
    }
  }
  return true;
}

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

  for (const name of DEFAULT_SEEDED_PERSONA_FILES) {
    const targetPath = path.join(realDir, name);
    const payload = templates[name];
    if (options?.overwrite) {
      await fs.writeFile(targetPath, payload, "utf8");
      created.push(name);
      continue;
    }
    const wrote = await writeFileIfMissing(targetPath, payload);
    if (wrote) {
      created.push(name);
    } else {
      existing.push(name);
    }
  }

  const bootstrapPath = path.join(realDir, "BOOTSTRAP.md");
  const statePath = resolveStatePath(realDir);
  let state = await readState(statePath);
  let dirty = false;
  const markState = (next: Partial<PersonaWorkspaceState>) => {
    state = { ...state, ...next };
    dirty = true;
  };

  let bootstrapExists = await fileExists(bootstrapPath);
  if (bootstrapExists && !state.bootstrapSeededAt) {
    markState({ bootstrapSeededAt: nowIso() });
  }

  if (!state.bootstrapSeededAt && !state.onboardingCompletedAt && !bootstrapExists) {
    const createBootstrap = await shouldCreateBootstrap({
      workspaceDir: realDir,
      identityPath: path.join(realDir, "IDENTITY.md"),
      userPath: path.join(realDir, "USER.md"),
    });
    if (createBootstrap) {
      const wroteBootstrap = await writeFileIfMissing(
        bootstrapPath,
        templates["BOOTSTRAP.md"],
      );
      bootstrapExists = wroteBootstrap || (await fileExists(bootstrapPath));
      if (bootstrapExists) {
        markState({ bootstrapSeededAt: nowIso() });
      }
    } else {
      markState({ onboardingCompletedAt: nowIso() });
    }
  }

  if (state.bootstrapSeededAt && !state.onboardingCompletedAt && !bootstrapExists) {
    markState({ onboardingCompletedAt: nowIso() });
  }

  if (dirty) {
    await writeState(statePath, state);
  }

  return {
    workspaceDir: realDir,
    created,
    existing,
    bootstrapPath,
    statePath,
  };
}
