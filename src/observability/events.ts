import type { RunLifecycleEvent, RunLifecycleListener } from "../types.js";

export class LifecycleEventBus {
  private readonly listeners: RunLifecycleListener[] = [];

  on(listener: RunLifecycleListener): void {
    this.listeners.push(listener);
  }

  async emit(event: RunLifecycleEvent): Promise<void> {
    for (const listener of this.listeners) {
      await listener(event);
    }
  }
}
