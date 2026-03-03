import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { TalosError } from "../errors.js";
import type { TalosPlugin } from "../types.js";

type PluginModuleShape = {
  default?: unknown;
  plugin?: unknown;
};

function isPlugin(value: unknown): value is TalosPlugin {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as { id?: unknown; setup?: unknown };
  return typeof candidate.id === "string" && typeof candidate.setup === "function";
}

export async function discoverPluginEntryPaths(directoryPath: string): Promise<string[]> {
  const normalizedPath = directoryPath.trim();
  if (!normalizedPath) {
    throw new TalosError({
      code: "PLUGIN_LOAD_FAILED",
      message: "Plugin directory path is required.",
    });
  }

  const realDirectory = await fs.realpath(normalizedPath).catch(() => null);
  if (!realDirectory) {
    throw new TalosError({
      code: "PLUGIN_LOAD_FAILED",
      message: `Plugin directory does not exist: ${normalizedPath}`,
    });
  }

  const stat = await fs.stat(realDirectory);
  if (!stat.isDirectory()) {
    throw new TalosError({
      code: "PLUGIN_LOAD_FAILED",
      message: `Plugin path is not a directory: ${normalizedPath}`,
    });
  }

  const entries = await fs.readdir(realDirectory, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /\.(mjs|js|cjs)$/.test(name))
    .sort((a, b) => a.localeCompare(b));

  return files.map((name) => path.join(realDirectory, name));
}

export async function loadPluginFromPath(filePath: string): Promise<TalosPlugin> {
  const normalizedPath = filePath.trim();
  if (!normalizedPath) {
    throw new TalosError({
      code: "PLUGIN_LOAD_FAILED",
      message: "Plugin file path is required.",
    });
  }

  const realPath = await fs.realpath(normalizedPath).catch(() => null);
  if (!realPath) {
    throw new TalosError({
      code: "PLUGIN_LOAD_FAILED",
      message: `Plugin file does not exist: ${normalizedPath}`,
    });
  }

  const stat = await fs.stat(realPath);
  if (!stat.isFile()) {
    throw new TalosError({
      code: "PLUGIN_LOAD_FAILED",
      message: `Plugin path is not a file: ${normalizedPath}`,
    });
  }

  let mod: PluginModuleShape;
  try {
    mod = (await import(pathToFileURL(realPath).href)) as PluginModuleShape;
  } catch (error) {
    throw new TalosError({
      code: "PLUGIN_LOAD_FAILED",
      message: `Failed to import plugin module: ${realPath}`,
      cause: error,
    });
  }

  const candidate = isPlugin(mod.default) ? mod.default : mod.plugin;
  if (!isPlugin(candidate)) {
    throw new TalosError({
      code: "PLUGIN_LOAD_FAILED",
      message:
        `Plugin module must export a plugin as default export or named export 'plugin': ${realPath}`,
    });
  }

  return candidate;
}
