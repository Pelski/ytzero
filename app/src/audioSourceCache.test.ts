import { describe, expect, test } from "bun:test";
import { AudioSourceCache } from "./audioSourceCache";

interface Source { url: string; expiresAt: number }

describe("audio source cache", () => {
  test("isolates the same video between profiles and invalidates one profile", () => {
    let now = 1_000;
    const cache = new AudioSourceCache<Source>(512, () => now);
    cache.set(1, "video", { url: "profile-one", expiresAt: 10_000 });
    cache.set(2, "video", { url: "profile-two", expiresAt: 10_000 });

    expect(cache.get(1, "video")?.url).toBe("profile-one");
    expect(cache.get(2, "video")?.url).toBe("profile-two");
    cache.invalidateUser(1);
    expect(cache.get(1, "video")).toBeNull();
    expect(cache.get(2, "video")?.url).toBe("profile-two");

    now = 10_000;
    expect(cache.get(2, "video")).toBeNull();
  });

  test("stays bounded and evicts the least recently used entry", () => {
    const cache = new AudioSourceCache<Source>(2, () => 0);
    cache.set(1, "a", { url: "a", expiresAt: 10_000 });
    cache.set(1, "b", { url: "b", expiresAt: 10_000 });
    expect(cache.get(1, "a")?.url).toBe("a");
    cache.set(1, "c", { url: "c", expiresAt: 10_000 });

    expect(cache.size).toBe(2);
    expect(cache.get(1, "b")).toBeNull();
    expect(cache.get(1, "a")?.url).toBe("a");
    expect(cache.get(1, "c")?.url).toBe("c");
  });
});
