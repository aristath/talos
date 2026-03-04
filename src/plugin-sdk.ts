import { TalosError } from "./errors.js";
import type { PluginCapability, TalosPlugin } from "./types.js";

export const TALOS_PLUGIN_API_VERSION = 1;

const ALLOWED_CAPABILITIES: ReadonlySet<PluginCapability> = new Set([
  "tools",
  "providers",
  "hooks",
]);

export function definePlugin(plugin: Omit<TalosPlugin, "apiVersion"> & { apiVersion?: number }): TalosPlugin {
  return {
    ...plugin,
    apiVersion: plugin.apiVersion ?? TALOS_PLUGIN_API_VERSION,
  };
}

export function assertPluginCompatibility(plugin: TalosPlugin): void {
  const normalizedId = plugin.id.trim();
  if (!normalizedId) {
    throw new TalosError({
      code: "PLUGIN_INVALID",
      message: "Plugin id is required.",
    });
  }

  const apiVersion = plugin.apiVersion ?? TALOS_PLUGIN_API_VERSION;
  if (apiVersion !== TALOS_PLUGIN_API_VERSION) {
    throw new TalosError({
      code: "PLUGIN_API_VERSION_UNSUPPORTED",
      message: `Plugin ${normalizedId} uses apiVersion ${apiVersion}, but runtime supports ${TALOS_PLUGIN_API_VERSION}.`,
    });
  }

  for (const capability of plugin.capabilities ?? []) {
    if (!ALLOWED_CAPABILITIES.has(capability)) {
      throw new TalosError({
        code: "PLUGIN_INVALID",
        message: `Plugin ${normalizedId} declares unsupported capability: ${capability}`,
      });
    }
  }
}
