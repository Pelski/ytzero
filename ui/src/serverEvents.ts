import { probeApiAuthentication } from "./apiTransport";

export type ServerEventTopic = "channel-sync" | "child-status" | "child-watching" | "child-requests" | "downloads" | "live" | "notifications" | "social";
export type ServerEventData = Record<string, unknown> | undefined;

const listeners = new Map<ServerEventTopic, Set<(data: ServerEventData) => void>>();
let source: EventSource | null = null;
let worker: SharedWorker | null = null;
let workerSubscribed = false;
let lifecycleListenersInstalled = false;

function notify(topic: ServerEventTopic, data?: ServerEventData) {
  for (const listener of listeners.get(topic) ?? []) {
    try { listener(data); } catch {}
  }
}

function dispatchWorkerMessage(event: MessageEvent<{ type: "app" | "ready" | "error"; data?: string }>) {
  if (event.data.type === "app") {
    try {
      const message = JSON.parse(event.data.data ?? "") as { topic: ServerEventTopic; data?: ServerEventData };
      if (listeners.has(message.topic)) notify(message.topic, message.data);
    } catch {}
  } else if (event.data.type === "ready") {
    for (const topic of listeners.keys()) notify(topic);
  } else if (event.data.type === "error") {
    void probeApiAuthentication();
  }
}

function connectSharedWorker(): boolean {
  if (!("SharedWorker" in globalThis)) return false;
  try {
    if (!worker) {
      worker = new SharedWorker(new URL("./serverEventsWorker.ts", import.meta.url), { type: "module", name: "ytzero-server-events" });
      worker.port.addEventListener("message", dispatchWorkerMessage);
      worker.port.start();
    }
    if (!workerSubscribed) {
      worker.port.postMessage({ type: "subscribe" });
      workerSubscribed = true;
    }
    if (!lifecycleListenersInstalled && typeof window !== "undefined" && typeof window.addEventListener === "function") {
      lifecycleListenersInstalled = true;
      window.addEventListener("pagehide", (event) => {
        if (event.persisted || !worker) return;
        worker.port.postMessage({ type: "disconnect" });
        worker = null;
        workerSubscribed = false;
      });
    }
    return true;
  } catch {
    worker = null;
    workerSubscribed = false;
    return false;
  }
}

function connect() {
  if (listeners.size === 0 || source || workerSubscribed) return;
  if (connectSharedWorker()) return;
  source = new EventSource("/api/events");
  let readySeen = false;
  source.addEventListener("app", (event) => {
    try {
      const message = JSON.parse((event as MessageEvent<string>).data) as { topic: ServerEventTopic; data?: ServerEventData };
      if (listeners.has(message.topic)) notify(message.topic, message.data);
    } catch {}
  });
  source.addEventListener("ready", () => {
    // Every subscriber loads its initial snapshot itself. Only refresh after
    // EventSource reconnects, because events may have been missed offline.
    if (!readySeen) {
      readySeen = true;
      return;
    }
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
      if (worker && workerSubscribed) {
        worker.port.postMessage({ type: "unsubscribe" });
        workerSubscribed = false;
      } else {
        source?.close();
        source = null;
      }
    }
  };
}
