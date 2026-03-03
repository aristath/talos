import type { PluginHooks } from "../types.js";
import { TalosError } from "../errors.js";

export class PluginRegistry {
  private readonly hooks: {
    beforeRun: PluginHooks["beforeRun"][];
    afterRun: PluginHooks["afterRun"][];
    beforeModel: PluginHooks["beforeModel"][];
    afterModel: PluginHooks["afterModel"][];
    beforeTool: PluginHooks["beforeTool"][];
    afterTool: PluginHooks["afterTool"][];
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
    if (name === "afterRun") {
      this.hooks.afterRun.push(handler as PluginHooks["afterRun"]);
      return;
    }
    if (name === "beforeTool") {
      this.hooks.beforeTool.push(handler as PluginHooks["beforeTool"]);
      return;
    }
    if (name === "afterTool") {
      this.hooks.afterTool.push(handler as PluginHooks["afterTool"]);
      return;
    }
    if (name === "beforeModel") {
      this.hooks.beforeModel.push(handler as PluginHooks["beforeModel"]);
      return;
    }
    if (name === "afterModel") {
      this.hooks.afterModel.push(handler as PluginHooks["afterModel"]);
      return;
    }
    throw new TalosError({
      code: "PLUGIN_HOOK_INVALID",
      message: `Unsupported hook: ${String(name)}`,
    });
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

  async runBeforeTool(input: Parameters<PluginHooks["beforeTool"]>[0]): Promise<void> {
    for (const hook of this.hooks.beforeTool) {
      await hook(input);
    }
  }

  async runAfterTool(input: Parameters<PluginHooks["afterTool"]>[0]): Promise<void> {
    for (const hook of this.hooks.afterTool) {
      await hook(input);
    }
  }

  async runBeforeModel(
    request: Parameters<PluginHooks["beforeModel"]>[0],
  ): Promise<Parameters<PluginHooks["beforeModel"]>[0]> {
    let current = request;
    for (const hook of this.hooks.beforeModel) {
      const next = await hook(current);
      if (next) {
        current = next;
      }
    }
    return current;
  }

  async runAfterModel(input: Parameters<PluginHooks["afterModel"]>[0]): Promise<void> {
    for (const hook of this.hooks.afterModel) {
      await hook(input);
    }
  }
}
