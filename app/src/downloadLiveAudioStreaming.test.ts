import { describe, expect, test } from "bun:test";
import { createDownloadStreaming } from "./downloadStreaming";
import type { DlSettings } from "./downloader";

const futureExpiry = 9_999_999_999;

function fakeProcess(stdout: string, exitCode = 0): ReturnType<typeof Bun.spawn> {
  return {
    stdout: new Response(stdout).body!,
    stderr: new Response("").body!,
    exited: Promise.resolve(exitCode),
    kill: () => {},
  } as unknown as ReturnType<typeof Bun.spawn>;
}

function factory(overrides: Partial<Parameters<typeof createDownloadStreaming>[0]> = {}) {
  return createDownloadStreaming({
    DOWNLOADS_DIR: "/tmp/ytzero-live-audio-test-unused",
    YTDLP: "yt-dlp",
    dlEnabled: async () => false,
    dlSettings: async () => ({}) as DlSettings,
    downloadCookiesConfigured: () => false,
    downloadCookiesFile: (userId) => `/cookies/${userId}.txt`,
    prioritizeDownload: async () => false,
    readLines: async () => {},
    ytdlpStatus: async () => "test",
    ...overrides,
  });
}

describe("live audio streaming", () => {
  test("rewrites a rolling playlist to opaque same-origin resources and streams one", async () => {
    const manifestUrl = `https://manifest.googlevideo.com/live/index.m3u8?expire=${futureExpiry}`;
    const segmentUrl = "https://r1.googlevideo.com/live/segment.ts?n=1";
    const requests: string[] = [];
    const live = factory({
      spawn: (() => fakeProcess(`${manifestUrl}\n`)) as unknown as typeof Bun.spawn,
      fetchImpl: (async (input, init) => {
        requests.push(String(input));
        expect(init?.redirect).toBe("manual");
        if (String(input) === manifestUrl) {
          return new Response(`#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\n${segmentUrl}\n`, {
            headers: { "Content-Type": "application/vnd.apple.mpegurl" },
          });
        }
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { "Content-Length": "3", "Content-Type": "video/mp2t" },
        });
      }) as typeof fetch,
    });

    const playlist = await live.getLiveAudioPlaylist(1, "video");
    expect(playlist).toContain("\nr0\n");
    expect(playlist).not.toContain("googlevideo.com/live/segment");
    const resource = await live.getLiveAudioResource(1, "video", "r0", null);
    expect(resource?.status).toBe(200);
    expect(resource?.headers.get("content-type")).toBe("video/mp2t");
    expect([...new Uint8Array(await resource!.arrayBuffer())]).toEqual([1, 2, 3]);
    expect(requests).toEqual([manifestUrl, segmentUrl]);
  });

  test("rejects playlists that escape the YouTube media host allowlist", async () => {
    const manifestUrl = `https://manifest.googlevideo.com/live/index.m3u8?expire=${futureExpiry}`;
    const live = factory({
      spawn: (() => fakeProcess(`${manifestUrl}\n`)) as unknown as typeof Bun.spawn,
      fetchImpl: (async () => new Response("#EXTM3U\n#EXTINF:6,\nhttps://example.com/segment.ts\n")) as unknown as typeof fetch,
    });
    expect(await live.getLiveAudioPlaylist(1, "video")).toBeNull();
  });

  test("reduces a multi-megabyte DVR manifest to a bounded live edge", async () => {
    const manifestUrl = `https://manifest.googlevideo.com/live/index.m3u8?expire=${futureExpiry}`;
    const padding = "x".repeat(900);
    const segments = Array.from({ length: 2_880 }, (_, index) =>
      `#EXTINF:5,\nhttps://r1.googlevideo.com/segment-${index}.ts?padding=${padding}`,
    );
    const source = `#EXTM3U\n#EXT-X-TARGETDURATION:5\n#EXT-X-MEDIA-SEQUENCE:1000\n${segments.join("\n")}\n`;
    expect(source.length).toBeGreaterThan(2 * 1024 * 1024);
    const live = factory({
      spawn: (() => fakeProcess(`${manifestUrl}\n`)) as unknown as typeof Bun.spawn,
      fetchImpl: (async () => new Response(source)) as unknown as typeof fetch,
    });

    const playlist = await live.getLiveAudioPlaylist(1, "video");
    expect(playlist).toContain("#EXT-X-MEDIA-SEQUENCE:3856");
    expect(playlist?.match(/^r\d+$/gm)).toHaveLength(24);
    expect(playlist?.length).toBeLessThan(2_000);
  });

  test("isolates resolved manifests between cookie profiles", async () => {
    let spawns = 0;
    const requested: string[] = [];
    const live = factory({
      downloadCookiesConfigured: () => true,
      spawn: ((command: string[]) => {
        spawns++;
        const cookieIndex = command.indexOf("--cookies");
        if (cookieIndex < 0) return fakeProcess("", 1);
        const userId = command[cookieIndex + 1].match(/(\d+)\.txt$/)?.[1];
        return fakeProcess(`https://manifest.googlevideo.com/profile-${userId}.m3u8?expire=${futureExpiry}\n`);
      }) as unknown as typeof Bun.spawn,
      fetchImpl: (async (input) => {
        requested.push(String(input));
        return new Response("#EXTM3U\n#EXTINF:6,\nhttps://r1.googlevideo.com/segment.ts\n");
      }) as typeof fetch,
    });

    await live.getLiveAudioPlaylist(1, "video");
    await live.getLiveAudioPlaylist(2, "video");
    expect(spawns).toBe(4);
    expect(requested[0]).toContain("profile-1");
    expect(requested[1]).toContain("profile-2");

    live.invalidateAudioSources(1);
    await live.getLiveAudioPlaylist(2, "video");
    expect(spawns).toBe(4);
    await live.getLiveAudioPlaylist(1, "video");
    expect(spawns).toBe(6);
  });

  test("an explicit live retry resolves a fresh manifest with yt-dlp", async () => {
    let spawns = 0;
    const live = factory({
      spawn: (() => fakeProcess(`https://manifest.googlevideo.com/version-${++spawns}.m3u8?expire=${futureExpiry}\n`)) as unknown as typeof Bun.spawn,
    });

    expect(await live.retryAudioSource(1, "video", true)).toBe(true);
    expect(spawns).toBe(1);
    expect(await live.retryAudioSource(1, "video", true)).toBe(true);
    expect(spawns).toBe(2);
  });

  test("keeps old segment tokens when a live manifest URL is refreshed", async () => {
    let spawns = 0;
    let staleManifestRequests = 0;
    const requested: string[] = [];
    const live = factory({
      spawn: (() => fakeProcess(`https://manifest.googlevideo.com/version-${++spawns}.m3u8\n`)) as unknown as typeof Bun.spawn,
      fetchImpl: (async (input) => {
        const url = String(input);
        requested.push(url);
        if (url.includes("version-1.m3u8") && staleManifestRequests++ > 0) return new Response(null, { status: 403 });
        if (url.includes("version-1.m3u8")) return new Response("#EXTM3U\n#EXTINF:6,\nhttps://r1.googlevideo.com/old.ts\n");
        if (url.includes("version-2.m3u8")) return new Response("#EXTM3U\n#EXTINF:6,\nhttps://r1.googlevideo.com/new.ts\n");
        return new Response(new Uint8Array([1]));
      }) as typeof fetch,
    });

    expect(await live.getLiveAudioPlaylist(1, "video")).toContain("\nr0\n");
    expect(await live.getLiveAudioPlaylist(1, "video")).toContain("\nr1\n");
    expect((await live.getLiveAudioResource(1, "video", "r0", null))?.status).toBe(200);
    expect((await live.getLiveAudioResource(1, "video", "r1", null))?.status).toBe(200);
    expect(requested.slice(-2)).toEqual([
      "https://r1.googlevideo.com/old.ts",
      "https://r1.googlevideo.com/new.ts",
    ]);
  });

  test("refreshes a rejected live segment and keeps its stable sequence token", async () => {
    let spawns = 0;
    let oldSegmentRequests = 0;
    const live = factory({
      spawn: (() => fakeProcess(`https://manifest.googlevideo.com/version-${++spawns}.m3u8\n`)) as unknown as typeof Bun.spawn,
      fetchImpl: (async (input) => {
        const url = String(input);
        if (url.includes("version-1.m3u8")) return new Response("#EXTM3U\n#EXTINF:2,\nhttps://r1.googlevideo.com/sq/42/old.ts\n");
        if (url.includes("version-2.m3u8")) return new Response("#EXTM3U\n#EXTINF:2,\nhttps://r2.googlevideo.com/sq/42/new.ts\n");
        if (url.includes("old.ts") && oldSegmentRequests++ === 0) return new Response(null, { status: 404 });
        return new Response(new Uint8Array([7]));
      }) as typeof fetch,
    });

    expect(await live.getLiveAudioPlaylist(1, "video")).toContain("\nr0\n");
    const resource = await live.getLiveAudioResource(1, "video", "r0", null);
    expect(resource?.status).toBe(200);
    expect([...new Uint8Array(await resource!.arrayBuffer())]).toEqual([7]);
    expect(spawns).toBe(2);
  });
});
