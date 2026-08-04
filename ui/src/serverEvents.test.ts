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
