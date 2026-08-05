import { afterEach, describe, expect, test } from "bun:test";
import { api } from "./api";
import { flushProgressWrite, queueProgressWrite } from "./progressWriteQueue";

const originalSaveProgress = api.saveProgress;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  api.saveProgress = originalSaveProgress;
});

describe("progress write queue", () => {
  test("throttles regular samples but flushes the newest one immediately", async () => {
    const calls: Array<[number, number, boolean]> = [];
    api.saveProgress = async (_id, position, duration, keepalive = false) => {
      calls.push([position, duration, keepalive]);
      return {};
    };

    queueProgressWrite("throttled", 1, 100);
    await settle();
    queueProgressWrite("throttled", 2, 100);
    queueProgressWrite("throttled", 3, 100);

    expect(calls).toEqual([[1, 100, false]]);
    flushProgressWrite("throttled");
    await settle();
    expect(calls).toEqual([[1, 100, false], [3, 100, false]]);
  });

  test("coalesces samples received while a request is in flight", async () => {
    const calls: number[] = [];
    let releaseFirst!: () => void;
    api.saveProgress = async (_id, position) => {
      calls.push(position);
      if (calls.length === 1) await new Promise<void>((resolve) => { releaseFirst = resolve; });
      return {};
    };

    queueProgressWrite("in-flight", 4, 100);
    queueProgressWrite("in-flight", 5, 100);
    queueProgressWrite("in-flight", 6, 100);
    flushProgressWrite("in-flight");
    expect(calls).toEqual([4]);

    releaseFirst();
    await settle();
    expect(calls).toEqual([4, 6]);
  });

  test("uses a keepalive request when the page is leaving", async () => {
    const calls: Array<[number, boolean]> = [];
    api.saveProgress = async (_id, position, _duration, keepalive = false) => {
      calls.push([position, keepalive]);
      return {};
    };

    queueProgressWrite("pagehide", 9, 100);
    await settle();
    queueProgressWrite("pagehide", 10, 100);
    flushProgressWrite("pagehide", true);
    await settle();

    expect(calls).toEqual([[9, false], [10, true]]);
  });
});
