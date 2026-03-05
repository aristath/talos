import type { AgentDefinition } from "../types.js";
import { SoulSwitchError } from "../errors.js";

export class AgentRegistry {
  private readonly agents = new Map<string, AgentDefinition>();

  register(agent: AgentDefinition): void {
    const id = agent.id.trim();
    if (!id) {
      throw new SoulSwitchError({
        code: "AGENT_INVALID",
        message: "Agent id is required.",
      });
    }
    this.agents.set(id, { ...agent, id });
  }

  resolve(id: string): AgentDefinition {
    const resolved = this.agents.get(id);
    if (!resolved) {
      throw new SoulSwitchError({
        code: "AGENT_NOT_FOUND",
        message: `Unknown agent: ${id}`,
      });
    }
    return resolved;
  }

  has(id: string): boolean {
    return this.agents.has(id.trim());
  }

  remove(id: string): boolean {
    const normalizedId = id.trim();
    if (!normalizedId) {
      return false;
    }
    return this.agents.delete(normalizedId);
  }

  list(): AgentDefinition[] {
    return Array.from(this.agents.values());
  }
}
