import { describe, expect, test } from "bun:test";
import type { AudioSource } from "./audioSourceResolver";
import { createDownloadAudioVodStreaming } from "./downloadAudioVodStreaming";

function concat(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.byteLength; }
  return output;
}

function uint16(value: number): Uint8Array {
  const output = new Uint8Array(2);
  new DataView(output.buffer).setUint16(0, value);
  return output;
}

function uint32(value: number): Uint8Array {
  const output = new Uint8Array(4);
  new DataView(output.buffer).setUint32(0, value);
  return output;
}

function box(type: string, payload: Uint8Array = new Uint8Array()): Uint8Array {
  return concat(
    uint32(payload.byteLength + 8),
    Uint8Array.from([...type].map((character) => character.charCodeAt(0))),
    payload,
  );
}

function indexedAudio(paddingBytes = 0): Uint8Array {
  const references = [
    { length: 4, duration: 6_000 },
    { length: 5, duration: 5_000 },
  ];
  const entries = references.map(({ length, duration }) => concat(uint32(length), uint32(duration), uint32(0)));
  const index = box("sidx", concat(
    Uint8Array.of(0, 0, 0, 0),
    uint32(1),
    uint32(1_000),
    uint32(0),
    uint32(0),
    uint16(0),
    uint16(references.length),
    ...entries,
  ));
  return concat(
    box("ftyp"),
    box("moov"),
    paddingBytes > 0 ? box("free", new Uint8Array(paddingBytes)) : new Uint8Array(),
    index,
    new Uint8Array(references.reduce((total, reference) => total + reference.length, 0)),
  );
}

function source(userId: number, revision = 1): AudioSource {
  return {
    url: `https://r1.googlevideo.com/profile-${userId}-v${revision}`,
    mime: "audio/mp4",
    expiresAt: Date.now() + 60_000,
  };
}

describe("audio VOD index streaming", () => {
  test("expands the prefix when needed and caches the generated playlist per source", async () => {
    const media = indexedAudio(70_000);
    const reads: Array<{ bytes: number; userId: number }> = [];
    const streaming = createDownloadAudioVodStreaming({
      audioDiagnostic: () => {},
      resolveAudioSource: async (userId) => source(userId),
      readPrefix: async (userId, _videoId, bytes) => {
        reads.push({ bytes, userId });
        return { bytes: media.slice(0, bytes), source: source(userId), total: media.byteLength };
      },
    });

    const first = await streaming.getAudioVodPlaylist(1, "video");
    expect(first.kind).toBe("playlist");
    if (first.kind === "playlist") {
      expect(first.playlist).toContain("#EXT-X-MAP");
      expect(first.playlist).toContain("#EXTINF:11,");
      expect(first.playlist).toContain("/api/videos/video/audio");
    }
    expect(reads.map(({ bytes }) => bytes)).toEqual([65_536, 70_032, 70_080]);

    expect((await streaming.getAudioVodPlaylist(1, "video")).kind).toBe("playlist");
    expect(reads).toHaveLength(3);
    expect((await streaming.getAudioVodPlaylist(2, "video")).kind).toBe("playlist");
    expect(reads.filter(({ userId }) => userId === 2)).toHaveLength(3);
  });

  test("caches a proven unsupported source but never caches a transient read failure", async () => {
    const unsupported = concat(box("ftyp"), box("moov"));
    let unsupportedReads = 0;
    const unsupportedStreaming = createDownloadAudioVodStreaming({
      audioDiagnostic: () => {},
      resolveAudioSource: async () => source(1),
      readPrefix: async () => {
        unsupportedReads++;
        return { bytes: unsupported, source: source(1), total: unsupported.byteLength };
      },
    });
    expect((await unsupportedStreaming.getAudioVodPlaylist(1, "video")).kind).toBe("unsupported");
    expect((await unsupportedStreaming.getAudioVodPlaylist(1, "video")).kind).toBe("unsupported");
    expect(unsupportedReads).toBe(1);

    const media = indexedAudio();
    let attempts = 0;
    const retryingStreaming = createDownloadAudioVodStreaming({
      audioDiagnostic: () => {},
      resolveAudioSource: async () => source(1),
      readPrefix: async () => {
        attempts++;
        return attempts === 1 ? null : { bytes: media, source: source(1), total: media.byteLength };
      },
    });
    expect((await retryingStreaming.getAudioVodPlaylist(1, "video")).kind).toBe("failed");
    expect((await retryingStreaming.getAudioVodPlaylist(1, "video")).kind).toBe("playlist");
    expect(attempts).toBe(2);
  });

  test("shares concurrent parsing and invalidation forces a fresh source read", async () => {
    const media = indexedAudio();
    let reads = 0;
    let releaseRead: () => void = () => {};
    const blocked = new Promise<void>((resolve) => { releaseRead = resolve; });
    const streaming = createDownloadAudioVodStreaming({
      audioDiagnostic: () => {},
      resolveAudioSource: async () => source(1),
      readPrefix: async () => {
        reads++;
        if (reads === 1) await blocked;
        return { bytes: media, source: source(1), total: media.byteLength };
      },
    });

    const first = streaming.getAudioVodPlaylist(1, "video");
    const second = streaming.getAudioVodPlaylist(1, "video");
    while (reads === 0) await Promise.resolve();
    releaseRead();
    expect((await first).kind).toBe("playlist");
    expect((await second).kind).toBe("playlist");
    expect(reads).toBe(1);

    streaming.invalidateAudioVodSource(1, "video");
    expect((await streaming.getAudioVodPlaylist(1, "video")).kind).toBe("playlist");
    expect(reads).toBe(2);
  });

  test("an aborted last waiter does not poison an immediate retry", async () => {
    const media = indexedAudio();
    let reads = 0;
    const streaming = createDownloadAudioVodStreaming({
      audioDiagnostic: () => {},
      resolveAudioSource: async () => source(1),
      readPrefix: async (_userId, _videoId, _bytes, signal) => {
        reads++;
        if (reads > 1) return { bytes: media, source: source(1), total: media.byteLength };
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
        return null;
      },
    });

    const controller = new AbortController();
    const aborted = streaming.getAudioVodPlaylist(1, "video", controller.signal);
    while (reads === 0) await Promise.resolve();
    controller.abort();
    const retry = streaming.getAudioVodPlaylist(1, "video");
    expect((await aborted).kind).toBe("failed");
    expect((await retry).kind).toBe("playlist");
    expect(reads).toBe(2);
  });
});
