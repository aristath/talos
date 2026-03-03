import type { PluginHooks } from "../types.js";
import { TalosError } from "../errors.js";

export class PluginRegistry {
  private readonly hooks: {
    beforeRun: PluginHooks["beforeRun"][];
    afterRun: PluginHooks["afterRun"][];
  } = {
    beforeRun: [],
    afterRun: [],
  };

  private readonly plugins = new Set<string>();

  assertNotRegistered(pluginId: string): void {
    const normalizedId = pluginId.trim();
    if (!normalizedId) {
      throw new TalosError({
        code: "PLUGIN_INVALID",
        message: "Plugin id is required.",
      });
    }
    if (this.plugins.has(normalizedId)) {
      throw new TalosError({
        code: "PLUGIN_DUPLICATE",
        message: `Plugin already registered: ${normalizedId}`,
      });
    }
  }

  markRegistered(pluginId: string): void {
    this.plugins.add(pluginId.trim());
  }

  addHook<K extends keyof PluginHooks>(name: K, handler: PluginHooks[K]): void {
    if (typeof handler !== "function") {
      throw new TalosError({
        code: "PLUGIN_HOOK_INVALID",
        message: `Hook handler for ${String(name)} must be a function.`,
      });
    }
    if (name === "beforeRun") {
      this.hooks.beforeRun.push(handler as PluginHooks["beforeRun"]);
      return;
    }
    this.hooks.afterRun.push(handler as PluginHooks["afterRun"]);
  }

  async runBeforeRun(input: Parameters<PluginHooks["beforeRun"]>[0]): Promise<void> {
    for (const hook of this.hooks.beforeRun) {
      await hook(input);
    }
  }

  async runAfterRun(result: Parameters<PluginHooks["afterRun"]>[0]): Promise<void> {
    for (const hook of this.hooks.afterRun) {
      await hook(result);
    }
  }
}
