import type { AgentDefinition } from "../types.js";

export class AgentRegistry {
  private readonly agents = new Map<string, AgentDefinition>();

  register(agent: AgentDefinition): void {
    const id = agent.id.trim();
    if (!id) {
      throw new Error("Agent id is required.");
    }
    this.agents.set(id, { ...agent, id });
  }

  resolve(id: string): AgentDefinition {
    const resolved = this.agents.get(id);
    if (!resolved) {
      throw new Error(`Unknown agent: ${id}`);
    }
    return resolved;
  }
}
