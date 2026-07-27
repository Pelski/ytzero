import { describe, expect, test } from "bun:test";
import { createAppEventBus } from "./appEvents";

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
});
