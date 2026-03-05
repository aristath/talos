import { SoulSwitchError } from "./errors.js";
import type { PluginCapability, SoulSwitchPlugin } from "./types.js";

export const SOULSWITCH_PLUGIN_API_VERSION = 1;

const ALLOWED_CAPABILITIES: ReadonlySet<PluginCapability> = new Set([
  "tools",
  "providers",
  "hooks",
]);

export function definePlugin(plugin: Omit<SoulSwitchPlugin, "apiVersion"> & { apiVersion?: number }): SoulSwitchPlugin {
  return {
    ...plugin,
    apiVersion: plugin.apiVersion ?? SOULSWITCH_PLUGIN_API_VERSION,
  };
}

export function assertPluginCompatibility(plugin: SoulSwitchPlugin): void {
  const normalizedId = plugin.id.trim();
  if (!normalizedId) {
    throw new SoulSwitchError({
      code: "PLUGIN_INVALID",
      message: "Plugin id is required.",
    });
  }

  const apiVersion = plugin.apiVersion ?? SOULSWITCH_PLUGIN_API_VERSION;
  if (apiVersion !== SOULSWITCH_PLUGIN_API_VERSION) {
    throw new SoulSwitchError({
      code: "PLUGIN_API_VERSION_UNSUPPORTED",
      message: `Plugin ${normalizedId} uses apiVersion ${apiVersion}, but runtime supports ${SOULSWITCH_PLUGIN_API_VERSION}.`,
    });
  }

  for (const capability of plugin.capabilities ?? []) {
    if (!ALLOWED_CAPABILITIES.has(capability)) {
      throw new SoulSwitchError({
        code: "PLUGIN_INVALID",
        message: `Plugin ${normalizedId} declares unsupported capability: ${capability}`,
      });
    }
  }
}
