import type { ToolDefinition, ToolResult } from "../types.js";

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    const name = tool.name.trim();
    if (!name) {
      throw new Error("Tool name is required.");
    }
    this.tools.set(name, { ...tool, name });
  }

  async execute(
    name: string,
    args: Record<string, unknown>,
    ctx: Parameters<ToolDefinition["run"]>[1],
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }
    return await tool.run(args, ctx);
  }
}
