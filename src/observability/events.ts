import type { RunLifecycleEvent, RunLifecycleListener } from "../types.js";

export class LifecycleEventBus {
  private readonly listeners: RunLifecycleListener[] = [];
  private readonly history: RunLifecycleEvent[] = [];
  private readonly maxHistory: number;

  constructor(maxHistory = 1000) {
    this.maxHistory = maxHistory;
  }

  on(listener: RunLifecycleListener): void {
    this.listeners.push(listener);
  }

  async emit(event: RunLifecycleEvent): Promise<void> {
    this.history.push(event);
    if (this.history.length > this.maxHistory) {
      this.history.splice(0, this.history.length - this.maxHistory);
    }
    for (const listener of this.listeners) {
      await listener(event);
    }
  }

  listEvents(limit = 100): RunLifecycleEvent[] {
    const safeLimit = Math.max(0, Math.floor(limit));
    if (safeLimit === 0) {
      return [];
    }
    return this.history.slice(-safeLimit);
  }

  listRunEvents(runId: string): RunLifecycleEvent[] {
    const normalizedRunId = runId.trim();
    if (!normalizedRunId) {
      return [];
    }
    return this.history.filter((event) => "runId" in event && event.runId === normalizedRunId);
  }
}
