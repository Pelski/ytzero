export type AppEventTopic = "channel-sync" | "child-status" | "child-watching" | "child-requests" | "downloads" | "live" | "notifications" | "social";
export type AppEvent = { topic: AppEventTopic; data?: Record<string, unknown>; userId?: number };

export function appEventVisibleToUser(event: AppEvent, userId: number): boolean {
  return event.userId === undefined || event.userId === userId;
}

export function createAppEventBus() {
  const listeners = new Set<(event: AppEvent) => void>();
  return {
    publish(event: AppEvent) {
      for (const listener of listeners) {
        try { listener(event); } catch {}
      }
    },
    subscribe(listener: (event: AppEvent) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const appEventBus = createAppEventBus();
export const publishAppEvent = (topic: AppEventTopic, data?: Record<string, unknown>) => appEventBus.publish({ topic, data });
export const publishAppEventForUser = (topic: AppEventTopic, userId: number, data?: Record<string, unknown>) => appEventBus.publish({ topic, data, userId });
export const subscribeToAppEvents = appEventBus.subscribe;

const pending = new Map<AppEventTopic, ReturnType<typeof setTimeout>>();
export function publishAppEventSoon(topic: AppEventTopic, delayMs: number, data?: Record<string, unknown>) {
  const existing = pending.get(topic);
  if (existing) clearTimeout(existing);
  pending.set(topic, setTimeout(() => {
    pending.delete(topic);
    publishAppEvent(topic, data);
  }, delayMs));
}
