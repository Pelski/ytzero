/// <reference lib="webworker" />

export {};

declare const self: SharedWorkerGlobalScope;

type ClientMessage = { type: "subscribe" | "unsubscribe" | "disconnect" };
type ServerMessage =
  | { type: "app"; data: string }
  | { type: "ready" }
  | { type: "error" };

const subscribedPorts = new Set<MessagePort>();
let source: EventSource | null = null;
let readySeen = false;

function broadcast(message: ServerMessage) {
  for (const port of subscribedPorts) {
    try { port.postMessage(message); } catch { subscribedPorts.delete(port); }
  }
  if (subscribedPorts.size === 0) closeSource();
}

function closeSource() {
  source?.close();
  source = null;
  readySeen = false;
}

function connect() {
  if (source || subscribedPorts.size === 0) return;
  source = new EventSource("/api/events");
  source.addEventListener("app", (event) => {
    broadcast({ type: "app", data: (event as MessageEvent<string>).data });
  });
  source.addEventListener("ready", () => {
    if (readySeen) broadcast({ type: "ready" });
    else readySeen = true;
  });
  source.addEventListener("error", () => broadcast({ type: "error" }));
}

self.onconnect = (event: MessageEvent) => {
  const port = event.ports[0];
  port.onmessage = (message: MessageEvent<ClientMessage>) => {
    if (message.data?.type === "subscribe") {
      subscribedPorts.add(port);
      connect();
      return;
    }
    subscribedPorts.delete(port);
    if (message.data?.type === "disconnect") port.close();
    if (subscribedPorts.size === 0) closeSource();
  };
  port.start();
};
