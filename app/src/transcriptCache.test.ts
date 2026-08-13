import { describe, expect, test } from "bun:test";
import { TranscriptCache } from "./transcriptCache";

describe("TranscriptCache", () => {
  test("caches a successful transcript for 30 minutes per profile and language", async () => {
    let now = 1_000;
    let loads = 0;
    const cache = new TranscriptCache(() => now);
    const load = async () => `transcript-${++loads}`;

    expect(await cache.get(1, "video", "pl", load)).toBe("transcript-1");
    expect(await cache.get(1, "video", "pl", load)).toBe("transcript-1");
    expect(await cache.get(2, "video", "pl", load)).toBe("transcript-2");
    expect(await cache.get(1, "video", "en", load)).toBe("transcript-3");
    now += 30 * 60_000 + 1;
    expect(await cache.get(1, "video", "pl", load)).toBe("transcript-4");
  });

  test("shares concurrent work and never caches a failure", async () => {
    const cache = new TranscriptCache();
    let loads = 0;
    let release!: (value: string) => void;
    const pending = new Promise<string>((resolve) => { release = resolve; });
    const first = cache.get(1, "video", "pl", async () => { loads += 1; return pending; });
    const second = cache.get(1, "video", "pl", async () => { loads += 1; return "wrong"; });
    release("shared");
    expect(await Promise.all([first, second])).toEqual(["shared", "shared"]);
    expect(loads).toBe(1);

    await expect(cache.get(1, "other", "pl", async () => { throw new Error("failed"); })).rejects.toThrow("failed");
    expect(await cache.get(1, "other", "pl", async () => "retried")).toBe("retried");
  });
});
