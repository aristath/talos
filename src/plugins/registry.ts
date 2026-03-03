import type { PluginHooks } from "../types.js";
import { TalosError } from "../errors.js";

export class PluginRegistry {
  private readonly hooks: {
    beforeRun: Array<{ pluginId: string; handler: PluginHooks["beforeRun"] }>;
    afterRun: Array<{ pluginId: string; handler: PluginHooks["afterRun"] }>;
    beforeModel: Array<{ pluginId: string; handler: PluginHooks["beforeModel"] }>;
    afterModel: Array<{ pluginId: string; handler: PluginHooks["afterModel"] }>;
    beforeTool: Array<{ pluginId: string; handler: PluginHooks["beforeTool"] }>;
    afterTool: Array<{ pluginId: string; handler: PluginHooks["afterTool"] }>;
  } = {
    beforeRun: [],
    afterRun: [],
    beforeModel: [],
    afterModel: [],
    beforeTool: [],
    afterTool: [],
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

  has(pluginId: string): boolean {
    return this.plugins.has(pluginId.trim());
  }

  list(): string[] {
    return Array.from(this.plugins.values()).sort((a, b) => a.localeCompare(b));
  }

  remove(pluginId: string): boolean {
    const normalizedId = pluginId.trim();
    if (!normalizedId || !this.plugins.has(normalizedId)) {
      return false;
    }

    this.plugins.delete(normalizedId);
    this.hooks.beforeRun = this.hooks.beforeRun.filter((entry) => entry.pluginId !== normalizedId);
    this.hooks.afterRun = this.hooks.afterRun.filter((entry) => entry.pluginId !== normalizedId);
    this.hooks.beforeModel = this.hooks.beforeModel.filter((entry) => entry.pluginId !== normalizedId);
    this.hooks.afterModel = this.hooks.afterModel.filter((entry) => entry.pluginId !== normalizedId);
    this.hooks.beforeTool = this.hooks.beforeTool.filter((entry) => entry.pluginId !== normalizedId);
    this.hooks.afterTool = this.hooks.afterTool.filter((entry) => entry.pluginId !== normalizedId);
    return true;
  }

  addHook<K extends keyof PluginHooks>(
    pluginId: string,
    name: K,
    handler: PluginHooks[K],
  ): void {
    if (typeof handler !== "function") {
      throw new TalosError({
        code: "PLUGIN_HOOK_INVALID",
        message: `Hook handler for ${String(name)} must be a function.`,
      });
    }
    if (name === "beforeRun") {
      this.hooks.beforeRun.push({ pluginId, handler: handler as PluginHooks["beforeRun"] });
      return;
    }
    if (name === "afterRun") {
      this.hooks.afterRun.push({ pluginId, handler: handler as PluginHooks["afterRun"] });
      return;
    }
    if (name === "beforeTool") {
      this.hooks.beforeTool.push({ pluginId, handler: handler as PluginHooks["beforeTool"] });
      return;
    }
    if (name === "afterTool") {
      this.hooks.afterTool.push({ pluginId, handler: handler as PluginHooks["afterTool"] });
      return;
    }
    if (name === "beforeModel") {
      this.hooks.beforeModel.push({ pluginId, handler: handler as PluginHooks["beforeModel"] });
      return;
    }
    if (name === "afterModel") {
      this.hooks.afterModel.push({ pluginId, handler: handler as PluginHooks["afterModel"] });
      return;
    }
    throw new TalosError({
      code: "PLUGIN_HOOK_INVALID",
      message: `Unsupported hook: ${String(name)}`,
    });
  }

  async runBeforeRun(input: Parameters<PluginHooks["beforeRun"]>[0]): Promise<void> {
    for (const hook of this.hooks.beforeRun) {
      await hook.handler(input);
    }
  }

  async runAfterRun(result: Parameters<PluginHooks["afterRun"]>[0]): Promise<void> {
    for (const hook of this.hooks.afterRun) {
      await hook.handler(result);
    }
  }

  async runBeforeTool(input: Parameters<PluginHooks["beforeTool"]>[0]): Promise<void> {
    for (const hook of this.hooks.beforeTool) {
      await hook.handler(input);
    }
  }

  async runAfterTool(input: Parameters<PluginHooks["afterTool"]>[0]): Promise<void> {
    for (const hook of this.hooks.afterTool) {
      await hook.handler(input);
    }
  }

  async runBeforeModel(
    request: Parameters<PluginHooks["beforeModel"]>[0],
  ): Promise<Parameters<PluginHooks["beforeModel"]>[0]> {
    let current = request;
    for (const hook of this.hooks.beforeModel) {
      const next = await hook.handler(current);
      if (next) {
        current = next;
      }
    }
    return current;
  }

  async runAfterModel(input: Parameters<PluginHooks["afterModel"]>[0]): Promise<void> {
    for (const hook of this.hooks.afterModel) {
      await hook.handler(input);
    }
  }
}
