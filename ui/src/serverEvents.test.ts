import { expect, test } from "bun:test";
import { subscribeServerEvent } from "./serverEvents";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners = new Map<string, Set<(event: { data: string }) => void>>();
  closed = false;

  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(name: string, listener: (event: { data: string }) => void) {
    const current = this.listeners.get(name) ?? new Set();
    current.add(listener);
    this.listeners.set(name, current);
  }

  emit(name: string, data = "{}") {
    for (const listener of this.listeners.get(name) ?? []) listener({ data });
  }

  close() { this.closed = true; }
}

test("server events share one SSE connection and dispatch by topic", () => {
  const original = globalThis.EventSource;
  (globalThis as any).EventSource = FakeEventSource;
  try {
    let childEvents = 0;
    let downloadEvents = 0;
    let channelSyncEvents = 0;
    const unsubscribeChild = subscribeServerEvent("child-watching", () => { childEvents++; });
    const unsubscribeDownloads = subscribeServerEvent("downloads", () => { downloadEvents++; });
    const unsubscribeChannelSync = subscribeServerEvent("channel-sync", () => { channelSyncEvents++; });
    expect(FakeEventSource.instances.length).toBe(1);
    const source = FakeEventSource.instances[0];
    expect(source.url).toBe("/api/events");

    source.emit("app", JSON.stringify({ topic: "child-watching" }));
    expect(childEvents).toBe(1);
    expect(downloadEvents).toBe(0);
    expect(channelSyncEvents).toBe(0);

    source.emit("app", JSON.stringify({ topic: "channel-sync" }));
    expect(channelSyncEvents).toBe(1);
    expect(childEvents).toBe(1);

    source.emit("ready");
    expect(childEvents).toBe(1);
    expect(downloadEvents).toBe(0);
    expect(channelSyncEvents).toBe(1);

    source.emit("ready");
    expect(childEvents).toBe(2);
    expect(downloadEvents).toBe(1);
    expect(channelSyncEvents).toBe(2);

    unsubscribeChild();
    expect(source.closed).toBe(false);
    unsubscribeDownloads();
    expect(source.closed).toBe(false);
    unsubscribeChannelSync();
    expect(source.closed).toBe(true);
  } finally {
    (globalThis as any).EventSource = original;
  }
});

test("server events use SharedWorker when available", () => {
  const originalWorker = globalThis.SharedWorker;
  const originalEventSource = globalThis.EventSource;
  const posted: string[] = [];
  class FakePort {
    listener: ((event: MessageEvent) => void) | null = null;
    addEventListener(name: string, listener: (event: MessageEvent) => void) { if (name === "message") this.listener = listener; }
    start() {}
    postMessage(message: { type: string }) { posted.push(message.type); }
    emit(data: unknown) { this.listener?.({ data } as MessageEvent); }
  }
  class FakeSharedWorker {
    static instances: FakeSharedWorker[] = [];
    port = new FakePort();
    constructor() { FakeSharedWorker.instances.push(this); }
  }
  (globalThis as any).SharedWorker = FakeSharedWorker;
  (globalThis as any).EventSource = class { constructor() { throw new Error("fallback should not open"); } };
  try {
    let events = 0;
    const unsubscribe = subscribeServerEvent("downloads", () => { events++; });
    expect(FakeSharedWorker.instances.length).toBe(1);
    expect(posted).toEqual(["subscribe"]);
    FakeSharedWorker.instances[0].port.emit({ type: "app", data: JSON.stringify({ topic: "downloads" }) });
    expect(events).toBe(1);
    unsubscribe();
    expect(posted).toEqual(["subscribe", "unsubscribe"]);
  } finally {
    (globalThis as any).SharedWorker = originalWorker;
    (globalThis as any).EventSource = originalEventSource;
  }
});
