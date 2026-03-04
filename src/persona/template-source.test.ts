import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_PERSONA_TEMPLATES } from "./templates.js";
import { loadPersonaTemplates, stripLeadingMarkdownFrontmatter } from "./template-source.js";

const TMP_DIRS: string[] = [];

async function createTmpDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "talos-template-source-"));
  TMP_DIRS.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of TMP_DIRS.splice(0, TMP_DIRS.length)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
  delete process.env.TALOS_PERSONA_TEMPLATE_DIR;
  await loadPersonaTemplates({ forceReload: true });
});

describe("loadPersonaTemplates", () => {
  it("keeps content unchanged when frontmatter is malformed", () => {
    const raw = "---\ntitle: Broken\n# Missing closing delimiter\n";
    expect(stripLeadingMarkdownFrontmatter(raw)).toBe(raw);
  });

  it("loads built-in docs templates by default", async () => {
    const templates = await loadPersonaTemplates({ forceReload: true });
    expect(templates["AGENTS.md"].trimStart().startsWith("# AGENTS.md - Your Workspace")).toBe(true);
    expect(templates["MEMORY.md"].trimStart().startsWith("# MEMORY.md")).toBe(true);
    expect(templates["memory.md"].trimStart().startsWith("# memory.md")).toBe(true);
  });

  it("loads templates from docs template directory when available", async () => {
    const dir = await createTmpDir();
    await fs.writeFile(path.join(dir, "SOUL.md"), "# SOUL.md\n\ndoc template\n", "utf8");

    process.env.TALOS_PERSONA_TEMPLATE_DIR = dir;
    const templates = await loadPersonaTemplates({ forceReload: true });

    expect(templates["SOUL.md"]).toBe("# SOUL.md\n\ndoc template\n");
  });

  it("strips leading markdown frontmatter", async () => {
    const dir = await createTmpDir();
    await fs.writeFile(
      path.join(dir, "USER.md"),
      "---\ntitle: User\n---\n# USER.md\n\nbody\n",
      "utf8",
    );

    process.env.TALOS_PERSONA_TEMPLATE_DIR = dir;
    const templates = await loadPersonaTemplates({ forceReload: true });

    expect(templates["USER.md"]).toBe("# USER.md\n\nbody\n");
  });

  it("falls back to embedded memory alias when only MEMORY.md is provided", async () => {
    const dir = await createTmpDir();
    await fs.writeFile(path.join(dir, "MEMORY.md"), "# MEMORY.md\n\ncustom memory\n", "utf8");

    process.env.TALOS_PERSONA_TEMPLATE_DIR = dir;
    const templates = await loadPersonaTemplates({ forceReload: true });

    expect(templates["MEMORY.md"]).toBe("# MEMORY.md\n\ncustom memory\n");
    expect(templates["memory.md"].trimStart().startsWith("# memory.md")).toBe(true);
  });

  it("keeps shipped docs templates aligned with embedded defaults", async () => {
    const docsDir = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../docs/reference/templates",
    );
    const entries = await fs.readdir(docsDir);
    for (const name of entries) {
      if (!name.endsWith(".md") || !(name in DEFAULT_PERSONA_TEMPLATES)) {
        continue;
      }
      const raw = await fs.readFile(path.join(docsDir, name), "utf8");
      const normalized = stripLeadingMarkdownFrontmatter(raw);
      expect(DEFAULT_PERSONA_TEMPLATES[name as keyof typeof DEFAULT_PERSONA_TEMPLATES].trimStart()).toBe(
        normalized.trimStart(),
      );
    }
  });
});
