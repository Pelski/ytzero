import { describe, expect, test } from "bun:test";
import { AsyncTtlCache } from "./asyncTtlCache";

describe("AsyncTtlCache", () => {
  test("coalesces concurrent work and reuses a recently completed result", async () => {
    let now = 1_000;
    let loads = 0;
    let finish!: (value: string) => void;
    const cache = new AsyncTtlCache<string>({ ttlMs: 60_000, now: () => now });
    const load = () => {
      loads++;
      return new Promise<string>((resolve) => { finish = resolve; });
    };

    const first = cache.run("profile:video", load);
    const concurrent = cache.run("profile:video", load);
    await Promise.resolve();
    expect(loads).toBe(1);

    // In-flight work remains shareable even if it lasts longer than the TTL.
    now += 60_001;
    const lateConcurrent = cache.run("profile:video", load);
    expect(loads).toBe(1);

    finish("imported");
    expect(await Promise.all([first, concurrent, lateConcurrent])).toEqual([
      "imported", "imported", "imported",
    ]);

    now += 59_999;
    expect(await cache.run("profile:video", load)).toBe("imported");
    expect(loads).toBe(1);
  });

  test("starts fresh work after the completed-result TTL", async () => {
    let now = 1_000;
    let loads = 0;
    const cache = new AsyncTtlCache<number>({ ttlMs: 60_000, now: () => now });
    const load = async () => ++loads;

    expect(await cache.run("profile:video", load)).toBe(1);
    now += 60_000;
    expect(await cache.run("profile:video", load)).toBe(2);
  });

  test("isolates keys and does not cache failures", async () => {
    const cache = new AsyncTtlCache<string>({ ttlMs: 60_000 });
    let loads = 0;
    const load = async () => {
      loads++;
      if (loads === 1) throw new Error("temporary failure");
      return `load-${loads}`;
    };

    await expect(cache.run("profile-1:video", load)).rejects.toThrow("temporary failure");
    expect(await cache.run("profile-1:video", load)).toBe("load-2");
    expect(await cache.run("profile-2:video", load)).toBe("load-3");
    expect(loads).toBe(3);
  });

  test("force skips a completed result but shares in-flight work", async () => {
    let loads = 0;
    const cache = new AsyncTtlCache<number>({ ttlMs: 60_000 });
    const load = async () => ++loads;

    expect(await cache.run("key", load)).toBe(1);
    expect(await cache.run("key", load, true)).toBe(2);

    let finish!: (value: number) => void;
    const pending = cache.run("other", () => new Promise<number>((resolve) => {
      loads++;
      finish = resolve;
    }));
    await Promise.resolve();
    const forcedPending = cache.run("other", load, true);
    finish(3);
    expect(await Promise.all([pending, forcedPending])).toEqual([3, 3]);
    expect(loads).toBe(3);
  });
});
