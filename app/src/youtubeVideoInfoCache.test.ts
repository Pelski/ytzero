import { afterEach, describe, expect, test } from "bun:test";
import { fetchVideoInfo } from "./youtube";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("video info cache", () => {
  test("coalesces concurrent player lookups and keeps the completed result", async () => {
    const videoId = "cacheTest01";
    let requests = 0;
    let release!: () => void;
    const pendingResponse = new Promise<void>((resolve) => { release = resolve; });
    const playerResponse = {
      videoDetails: {
        videoId,
        title: "Cached video",
        channelId: "UCcache-test-channel",
        author: "Cache channel",
        shortDescription: "",
        thumbnail: { thumbnails: [] },
        viewCount: "1",
        lengthSeconds: "60",
      },
      microformat: { playerMicroformatRenderer: { publishDate: "2026-09-08" } },
    };
    globalThis.fetch = (async () => {
      requests++;
      await pendingResponse;
      return new Response(`ytInitialPlayerResponse = ${JSON.stringify(playerResponse)};`);
    }) as unknown as typeof fetch;

    const first = fetchVideoInfo(videoId);
    const concurrent = fetchVideoInfo(videoId);
    await Promise.resolve();
    await Promise.resolve();
    expect(requests).toBe(1);

    release();
    expect((await Promise.all([first, concurrent])).map((info) => info.title)).toEqual([
      "Cached video", "Cached video",
    ]);
    expect((await fetchVideoInfo(videoId)).title).toBe("Cached video");
    expect(requests).toBe(1);
  });
});
