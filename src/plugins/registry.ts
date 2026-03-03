import type { PluginHooks } from "../types.js";

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
    if (this.plugins.has(pluginId)) {
      throw new Error(`Plugin already registered: ${pluginId}`);
    }
  }

  markRegistered(pluginId: string): void {
    this.plugins.add(pluginId);
  }

  addHook<K extends keyof PluginHooks>(name: K, handler: PluginHooks[K]): void {
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
