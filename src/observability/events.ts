import type {
  EventQuery,
  RunLifecycleEvent,
  RunLifecycleListener,
  RunQuery,
  RunLifecycleUnsubscribe,
  RunStats,
  RunSummary,
} from "../types.js";

export class LifecycleEventBus {
  private readonly listeners: RunLifecycleListener[] = [];
  private readonly history: RunLifecycleEvent[] = [];
  private readonly runs = new Map<string, RunSummary>();
  private readonly maxHistory: number;
  private readonly maxRuns: number;

  constructor(maxHistory = 1000, maxRuns = 1000) {
    this.maxHistory = maxHistory;
    this.maxRuns = maxRuns;
  }

  on(listener: RunLifecycleListener): RunLifecycleUnsubscribe {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) {
        this.listeners.splice(index, 1);
      }
    };
  }

  async emit(event: RunLifecycleEvent): Promise<void> {
    this.history.push(event);
    if (this.history.length > this.maxHistory) {
      this.history.splice(0, this.history.length - this.maxHistory);
    }

    this.updateRunSummary(event);

    for (const listener of this.listeners) {
      await listener(event);
    }
  }

  private updateRunSummary(event: RunLifecycleEvent): void {
    if (!("runId" in event)) {
      return;
    }

    if (event.type === "run.started") {
      this.runs.set(event.runId, {
        runId: event.runId,
        agentId: event.data.agentId,
        ...(event.data.sessionId ? { sessionId: event.data.sessionId } : {}),
        status: "running",
        startedAt: event.at,
      });
      this.trimRunsIfNeeded();
      return;
    }

    const current = this.runs.get(event.runId);
    if (!current) {
      return;
    }

    if (event.type === "run.completed") {
      this.runs.set(event.runId, {
        ...current,
        status: "completed",
        finishedAt: event.at,
        providerId: event.data.providerId,
        modelId: event.data.modelId,
      });
      return;
    }

    if (event.type === "run.failed") {
      this.runs.set(event.runId, {
        ...current,
        status: "failed",
        finishedAt: event.at,
        error: event.data.error,
      });
      return;
    }

    if (event.type === "run.cancelled") {
      this.runs.set(event.runId, {
        ...current,
        status: "cancelled",
        finishedAt: event.at,
        error: {
          name: "TalosError",
          code: "RUN_CANCELLED",
          message: event.data.reason,
        },
      });
    }
  }

  private trimRunsIfNeeded(): void {
    if (this.runs.size <= this.maxRuns) {
      return;
    }
    const overflow = this.runs.size - this.maxRuns;
    const keys = this.runs.keys();
    for (let i = 0; i < overflow; i += 1) {
      const key = keys.next().value;
      if (typeof key !== "string") {
        return;
      }
      this.runs.delete(key);
    }
  }

  listEvents(limit = 100): RunLifecycleEvent[] {
    const safeLimit = Math.max(0, Math.floor(limit));
    if (safeLimit === 0) {
      return [];
    }
    return this.history.slice(-safeLimit);
  }

  queryEvents(query?: EventQuery): RunLifecycleEvent[] {
    const safeLimit = Math.max(0, Math.floor(query?.limit ?? 100));
    if (safeLimit === 0) {
      return [];
    }
    const type = query?.type;
    const runId = query?.runId?.trim();

    return this.history
      .filter((event) => (type ? event.type === type : true))
      .filter((event) => {
        if (!runId) {
          return true;
        }
        return "runId" in event && event.runId === runId;
      })
      .slice(-safeLimit);
  }

  listRunEvents(runId: string): RunLifecycleEvent[] {
    const normalizedRunId = runId.trim();
    if (!normalizedRunId) {
      return [];
    }
    return this.history.filter((event) => "runId" in event && event.runId === normalizedRunId);
  }

  listRuns(limit = 100): RunSummary[] {
    const safeLimit = Math.max(0, Math.floor(limit));
    if (safeLimit === 0) {
      return [];
    }
    const runs = Array.from(this.runs.values());
    return runs.slice(-safeLimit).reverse();
  }

  queryRuns(query?: RunQuery): RunSummary[] {
    const safeLimit = Math.max(0, Math.floor(query?.limit ?? 100));
    if (safeLimit === 0) {
      return [];
    }
    const agentId = query?.agentId?.trim();
    const status = query?.status;
    const runs = Array.from(this.runs.values()).reverse();
    return runs
      .filter((run) => (agentId ? run.agentId === agentId : true))
      .filter((run) => (status ? run.status === status : true))
      .slice(0, safeLimit);
  }

  getRun(runId: string): RunSummary | undefined {
    const normalizedRunId = runId.trim();
    if (!normalizedRunId) {
      return undefined;
    }
    return this.runs.get(normalizedRunId);
  }

  getRunStats(): RunStats {
    let running = 0;
    let completed = 0;
    let failed = 0;
    let cancelled = 0;

    for (const run of this.runs.values()) {
      if (run.status === "running") {
        running += 1;
        continue;
      }
      if (run.status === "completed") {
        completed += 1;
        continue;
      }
      if (run.status === "failed") {
        failed += 1;
        continue;
      }
      cancelled += 1;
    }

    return {
      total: this.runs.size,
      running,
      completed,
      failed,
      cancelled,
    };
  }
}
