import { probeApiAuthentication } from "./apiTransport";

export type ServerEventTopic = "child-status" | "child-watching" | "child-requests" | "downloads" | "live" | "notifications";
export type ServerEventData = Record<string, unknown> | undefined;

const listeners = new Map<ServerEventTopic, Set<(data: ServerEventData) => void>>();
let source: EventSource | null = null;

function notify(topic: ServerEventTopic, data?: ServerEventData) {
  for (const listener of listeners.get(topic) ?? []) {
    try { listener(data); } catch {}
  }
}

function connect() {
  if (source || listeners.size === 0) return;
  source = new EventSource("/api/events");
  source.addEventListener("app", (event) => {
    try {
      const message = JSON.parse((event as MessageEvent<string>).data) as { topic: ServerEventTopic; data?: ServerEventData };
      if (listeners.has(message.topic)) notify(message.topic, message.data);
    } catch {}
  });
  source.addEventListener("ready", () => {
    for (const topic of listeners.keys()) notify(topic);
  });
  source.addEventListener("error", () => {
    void probeApiAuthentication();
  });
}

export function subscribeServerEvent(topic: ServerEventTopic, listener: (data: ServerEventData) => void) {
  const topicListeners = listeners.get(topic) ?? new Set();
  topicListeners.add(listener);
  listeners.set(topic, topicListeners);
  connect();
  return () => {
    topicListeners.delete(listener);
    if (topicListeners.size === 0) listeners.delete(topic);
    if (listeners.size === 0) {
      source?.close();
      source = null;
    }
  };
}
