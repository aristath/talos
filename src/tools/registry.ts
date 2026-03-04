import type { ToolDefinition, ToolResult } from "../types.js";
import { TalosError } from "../errors.js";

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    const name = tool.name.trim();
    if (!name) {
      throw new TalosError({
        code: "PLUGIN_INVALID",
        message: "Tool name is required.",
      });
    }
    this.tools.set(name, { ...tool, name });
  }

  has(name: string): boolean {
    return this.tools.has(name.trim());
  }

  remove(name: string): boolean {
    const normalizedName = name.trim();
    if (!normalizedName) {
      return false;
    }
    return this.tools.delete(normalizedName);
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  async execute(
    name: string,
    args: Record<string, unknown>,
    ctx: Parameters<ToolDefinition["run"]>[1],
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new TalosError({
        code: "PLUGIN_INVALID",
        message: `Unknown tool: ${name}`,
      });
    }
    return await tool.run(args, ctx);
  }
}
