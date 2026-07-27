export type AppEventTopic = "child-status" | "child-watching" | "child-requests" | "downloads" | "live" | "notifications";
export type AppEvent = { topic: AppEventTopic; data?: Record<string, unknown> };

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
