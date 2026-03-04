import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { seedPersonaWorkspace } from "./bootstrap.js";
import { DEFAULT_PERSONA_TEMPLATES } from "./templates.js";

const tmpDirs: string[] = [];

async function createTmpDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "talos-persona-bootstrap-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map(async (dir) => fs.rm(dir, { recursive: true, force: true })));
  delete process.env.TALOS_PERSONA_TEMPLATE_DIR;
});

describe("seedPersonaWorkspace", () => {
  it("creates default seeded persona files", async () => {
    const dir = await createTmpDir();

    const result = await seedPersonaWorkspace(dir);

    expect(result.created).toContain("AGENTS.md");
    expect(result.created).toContain("SOUL.md");
    expect(result.created).toContain("TOOLS.md");
    expect(result.created).toContain("HEARTBEAT.md");
    const agents = await fs.readFile(path.join(dir, "AGENTS.md"), "utf8");
    expect(agents.includes("# AGENTS.md")).toBe(true);
  });

  it("creates BOOTSTRAP.md on fresh workspace and tracks state", async () => {
    const dir = await createTmpDir();
    const result = await seedPersonaWorkspace(dir);

    const bootstrapExists = await fs
      .access(path.join(dir, "BOOTSTRAP.md"))
      .then(() => true)
      .catch(() => false);

    expect(bootstrapExists).toBe(true);
    expect(result.statePath.endsWith(path.join(".openclaw", "workspace-state.json"))).toBe(true);
    const stateRaw = await fs.readFile(result.statePath, "utf8");
    const state = JSON.parse(stateRaw) as {
      bootstrapSeededAt?: string;
    };
    expect(typeof state.bootstrapSeededAt).toBe("string");
  });

  it("seeds openclaw template content", async () => {
    const dir = await createTmpDir();
    await seedPersonaWorkspace(dir);

    const agents = await fs.readFile(path.join(dir, "AGENTS.md"), "utf8");
    const soul = await fs.readFile(path.join(dir, "SOUL.md"), "utf8");

    expect(agents.includes("Don't ask permission. Just do it.")).toBe(true);
    expect(agents.includes("Read `SOUL.md` — this is who you are")).toBe(true);
    expect(soul.includes("You're not a chatbot. You're becoming someone.")).toBe(true);
  });

  it("marks onboarding completed after BOOTSTRAP is removed", async () => {
    const dir = await createTmpDir();
    const first = await seedPersonaWorkspace(dir);
    await fs.rm(first.bootstrapPath, { force: true });

    const second = await seedPersonaWorkspace(dir);
    const stateRaw = await fs.readFile(second.statePath, "utf8");
    const state = JSON.parse(stateRaw) as {
      onboardingCompletedAt?: string;
    };
    expect(typeof state.onboardingCompletedAt).toBe("string");
  });

  it("does not recreate bootstrap for legacy onboarded workspaces", async () => {
    const dir = await createTmpDir();
    await fs.writeFile(path.join(dir, "IDENTITY.md"), "# IDENTITY.md\n\ncustom\n", "utf8");
    await fs.writeFile(path.join(dir, "USER.md"), DEFAULT_PERSONA_TEMPLATES["USER.md"], "utf8");

    const result = await seedPersonaWorkspace(dir);
    const bootstrapExists = await fs
      .access(path.join(dir, "BOOTSTRAP.md"))
      .then(() => true)
      .catch(() => false);

    expect(bootstrapExists).toBe(false);
    const stateRaw = await fs.readFile(result.statePath, "utf8");
    const state = JSON.parse(stateRaw) as {
      onboardingCompletedAt?: string;
      bootstrapSeededAt?: string;
    };
    expect(typeof state.onboardingCompletedAt).toBe("string");
    expect(state.bootstrapSeededAt).toBeUndefined();
  });

  it("backfills bootstrap marker when bootstrap file already exists", async () => {
    const dir = await createTmpDir();
    await fs.writeFile(path.join(dir, "BOOTSTRAP.md"), DEFAULT_PERSONA_TEMPLATES["BOOTSTRAP.md"], "utf8");

    const result = await seedPersonaWorkspace(dir);
    const stateRaw = await fs.readFile(result.statePath, "utf8");
    const state = JSON.parse(stateRaw) as {
      bootstrapSeededAt?: string;
    };
    expect(typeof state.bootstrapSeededAt).toBe("string");
  });

  it("does not overwrite by default and supports overwrite mode", async () => {
    const dir = await createTmpDir();
    const userContent = "# SOUL.md\n\ncustom\n";
    await fs.writeFile(path.join(dir, "SOUL.md"), userContent, "utf8");

    const first = await seedPersonaWorkspace(dir);
    expect(first.existing).toContain("SOUL.md");
    const soulBefore = await fs.readFile(path.join(dir, "SOUL.md"), "utf8");
    expect(soulBefore).toBe(userContent);

    const second = await seedPersonaWorkspace(dir, { overwrite: true });
    expect(second.created).toContain("SOUL.md");
    const soulAfter = await fs.readFile(path.join(dir, "SOUL.md"), "utf8");
    expect(soulAfter).not.toBe(userContent);
  });

  it("uses external template directory when TALOS_PERSONA_TEMPLATE_DIR is set", async () => {
    const dir = await createTmpDir();
    const templatesDir = await createTmpDir();
    await fs.writeFile(path.join(templatesDir, "SOUL.md"), "# SOUL.md\n\nexternal soul\n", "utf8");

    process.env.TALOS_PERSONA_TEMPLATE_DIR = templatesDir;
    await seedPersonaWorkspace(dir, { overwrite: true });

    const soul = await fs.readFile(path.join(dir, "SOUL.md"), "utf8");
    expect(soul).toBe("# SOUL.md\n\nexternal soul\n");
  });
});
