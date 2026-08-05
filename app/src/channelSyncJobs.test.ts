import { describe, expect, test } from "bun:test";
import { createChannelSyncJobManager } from "./channelSyncJobs";

const targets = [
  { channelId: "UC_one", title: "One" },
  { channelId: "UC_two", title: "Two" },
  { channelId: "UC_three", title: "Three" },
];

function manager(overrides: Partial<Parameters<typeof createChannelSyncJobManager>[0]> = {}) {
  let mutations = 0;
  const published: number[] = [];
  let busyPublished = 0;
  const calls: string[] = [];
  const instance = createChannelSyncJobManager({
    syncChannel: async (channelId) => {
      calls.push(channelId);
      return { added: channelId === "UC_two" ? 2 : 1 };
    },
    beginMutation: () => {
      mutations++;
      return () => { mutations--; };
    },
    publish: (userId) => { published.push(userId); },
    publishBusy: () => { busyPublished++; },
    sleep: async () => {},
    delayMs: 0,
    now: () => new Date("2026-08-04T10:00:00.000Z"),
    createId: () => "job-1",
    ...overrides,
  });
  return { instance, calls, published, busyPublished: () => busyPublished, mutations: () => mutations };
}

describe("channel sync background jobs", () => {
  test("deduplicates targets, runs sequentially and publishes immutable progress", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const { instance, calls, published, busyPublished, mutations } = manager({
      syncChannel: async (channelId) => {
        calls.push(channelId);
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await Promise.resolve();
        concurrent--;
        return { added: 1 };
      },
    });

    const accepted = instance.start(7, [targets[0], targets[0], targets[1]]);
    accepted.channels[0].title = "mutated outside";
    expect(accepted.total).toBe(2);
    expect(accepted.status).toBe("running");
    await instance.waitForIdle();

    const result = instance.current(7)!;
    expect(calls).toEqual(["UC_one", "UC_two"]);
    expect(maxConcurrent).toBe(1);
    expect(result.channels.map((channel) => channel.title)).toEqual(["One", "Two"]);
    expect(result.status).toBe("completed");
    expect(result.processed).toBe(2);
    expect(result.succeeded).toBe(2);
    expect(result.added).toBe(2);
    expect(result.revision).toBeGreaterThan(accepted.revision);
    expect(instance.current(8)).toBeNull();
    expect(published.length).toBeGreaterThan(2);
    expect(published.every((userId) => userId === 7)).toBe(true);
    expect(busyPublished()).toBe(2);
    expect(mutations()).toBe(0);
  });

  test("continues after an ordinary channel failure", async () => {
    const { instance, calls } = manager({
      syncChannel: async (channelId) => {
        calls.push(channelId);
        if (channelId === "UC_one") throw new Error("layout changed");
        return { added: 4 };
      },
    });
    instance.start(1, targets.slice(0, 2));
    await instance.waitForIdle();

    const result = instance.current(1)!;
    expect(calls).toEqual(["UC_one", "UC_two"]);
    expect(result.status).toBe("completed");
    expect(result.failed).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.added).toBe(4);
  });

  test("halts on a reported rate limit and skips remaining channels", async () => {
    const { instance, calls } = manager({
      syncChannel: async (channelId) => {
        calls.push(channelId);
        return channelId === "UC_one" ? { added: 3, rateLimited: true } : { added: 1 };
      },
    });
    instance.start(2, targets);
    await instance.waitForIdle();

    const result = instance.current(2)!;
    expect(calls).toEqual(["UC_one"]);
    expect(result.status).toBe("halted");
    expect(result.failed).toBe(1);
    expect(result.skipped).toBe(2);
    expect(result.processed).toBe(1);
    expect(result.added).toBe(3);
    expect(result.channels.map((channel) => channel.status)).toEqual(["failed", "skipped", "skipped"]);
  });

  test("treats a YouTube bot challenge as a rate limit", async () => {
    const { instance, calls } = manager({
      syncChannel: async (channelId) => {
        calls.push(channelId);
        throw new Error("Please confirm you're not a bot");
      },
    });
    instance.start(9, targets.slice(0, 2));
    await instance.waitForIdle();
    expect(calls).toEqual(["UC_one"]);
    expect(instance.current(9)?.status).toBe("halted");
    expect(instance.current(9)?.skipped).toBe(1);
  });

  test("runs jobs for different profiles without globally blocking them", async () => {
    const resolvers = new Map<string, (value: { added: number }) => void>();
    const { instance, mutations } = manager({
      syncChannel: (channelId) => new Promise((resolve) => { resolvers.set(channelId, resolve); }),
    });
    instance.start(3, [targets[0]]);
    instance.start(4, [targets[1]]);
    await Promise.resolve();
    expect(mutations()).toBe(2);
    resolvers.get("UC_one")!({ added: 0 });
    resolvers.get("UC_two")!({ added: 0 });
    await instance.waitForIdle();
    expect(mutations()).toBe(0);
    expect(instance.current(3)?.status).toBe("completed");
    expect(instance.current(4)?.status).toBe("completed");
  });

  test("adds a manual request to the active profile job and prioritizes it next", async () => {
    let releaseFirst: ((value: { added: number }) => void) | null = null;
    const { instance, calls } = manager({
      syncChannel: (channelId) => {
        calls.push(channelId);
        if (channelId === "UC_one") return new Promise((resolve) => { releaseFirst = resolve; });
        return Promise.resolve({ added: 1 });
      },
    });
    const original = instance.start(3, targets.slice(0, 2));
    await Promise.resolve();
    const expanded = instance.start(3, [targets[2], targets[1]]);

    expect(expanded.id).toBe(original.id);
    expect(expanded.total).toBe(3);
    expect(expanded.channels.map((channel) => channel.channelId)).toEqual(["UC_one", "UC_three", "UC_two"]);
    releaseFirst!({ added: 0 });
    await instance.waitForIdle();
    expect(calls).toEqual(["UC_one", "UC_three", "UC_two"]);
  });

  test("halts cleanly when maintenance owns the write lease", async () => {
    const { instance, calls } = manager({ beginMutation: () => null });
    instance.start(5, targets.slice(0, 2));
    await instance.waitForIdle();

    const result = instance.current(5)!;
    expect(calls).toEqual([]);
    expect(result.status).toBe("halted");
    expect(result.skipped).toBe(2);
  });

  test("releases the lease between channels so maintenance can stop a long batch", async () => {
    let leases = 0;
    let activeMutations = 0;
    const { instance, calls } = manager({
      beginMutation: () => {
        leases++;
        if (leases === 2) return null;
        activeMutations++;
        return () => { activeMutations--; };
      },
    });
    instance.start(6, targets);
    await instance.waitForIdle();

    const result = instance.current(6)!;
    expect(calls).toEqual(["UC_one"]);
    expect(result.status).toBe("halted");
    expect(result.succeeded).toBe(1);
    expect(result.skipped).toBe(2);
    expect(activeMutations).toBe(0);
  });
});
