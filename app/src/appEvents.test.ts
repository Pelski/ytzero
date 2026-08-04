import { describe, expect, test } from "bun:test";
import { appEventVisibleToUser, createAppEventBus } from "./appEvents";

describe("application event bus", () => {
  test("publishes events and stops after unsubscribe", () => {
    const bus = createAppEventBus();
    const events: string[] = [];
    const unsubscribe = bus.subscribe((event) => events.push(event.topic));
    bus.publish({ topic: "child-status" });
    unsubscribe();
    bus.publish({ topic: "live" });
    expect(events).toEqual(["child-status"]);
  });

  test("isolates a broken subscriber", () => {
    const bus = createAppEventBus();
    let received = false;
    bus.subscribe(() => { throw new Error("boom"); });
    bus.subscribe(() => { received = true; });
    bus.publish({ topic: "downloads" });
    expect(received).toBe(true);
  });

  test("scopes targeted events to their profile while keeping shared events visible", () => {
    expect(appEventVisibleToUser({ topic: "channel-sync", userId: 4 }, 4)).toBe(true);
    expect(appEventVisibleToUser({ topic: "channel-sync", userId: 4 }, 5)).toBe(false);
    expect(appEventVisibleToUser({ topic: "live" }, 5)).toBe(true);
  });
});
