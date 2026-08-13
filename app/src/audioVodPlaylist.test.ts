import { describe, expect, test } from "bun:test";
import { AUDIO_CHUNK_BYTES } from "./audioRange";
import type { AudioSidxIndex, AudioSidxReference } from "./audioSidx";
import { createAudioVodPlaylist, groupAudioSidxReferences } from "./audioVodPlaylist";

function indexFor(references: AudioSidxReference[], overrides: Partial<AudioSidxIndex> = {}): AudioSidxIndex {
  return {
    version: 0,
    timescale: 1_000,
    earliestPresentationTime: 0,
    sidxOffset: 723,
    sidxLength: 277,
    initializationLength: 723,
    firstMediaOffset: references[0]?.offset ?? 1_000,
    references,
    ...overrides,
  };
}

describe("audio VOD HLS playlist", () => {
  test("groups contiguous fragments around ten seconds and emits direct byte ranges", () => {
    const index = indexFor([
      { offset: 1_000, length: 100, durationTicks: 4_000 },
      { offset: 1_100, length: 200, durationTicks: 3_000 },
      { offset: 1_300, length: 300, durationTicks: 3_007 },
      { offset: 1_600, length: 400, durationTicks: 6_000 },
      { offset: 2_000, length: 500, durationTicks: 5_000 },
    ]);

    expect(groupAudioSidxReferences(index)).toEqual([
      { offset: 1_000, length: 600, durationTicks: 10_007, durationSeconds: 10.007 },
      { offset: 1_600, length: 900, durationTicks: 11_000, durationSeconds: 11 },
    ]);
    expect(createAudioVodPlaylist("video/id", index)).toBe([
      "#EXTM3U",
      "#EXT-X-VERSION:7",
      "#EXT-X-PLAYLIST-TYPE:VOD",
      "#EXT-X-TARGETDURATION:11",
      "#EXT-X-MAP:URI=\"/api/videos/video%2Fid/audio\",BYTERANGE=\"723@0\"",
      "#EXTINF:10.007,",
      "#EXT-X-BYTERANGE:600@1000",
      "/api/videos/video%2Fid/audio",
      "#EXTINF:11,",
      "#EXT-X-BYTERANGE:900@1600",
      "/api/videos/video%2Fid/audio",
      "#EXT-X-ENDLIST",
      "",
    ].join("\n"));
  });

  test("splits a group before it can exceed the audio proxy chunk limit", () => {
    const firstLength = 6 * 1024 * 1024;
    const secondLength = 3 * 1024 * 1024;
    const index = indexFor([
      { offset: 1_000, length: firstLength, durationTicks: 1_000 },
      { offset: 1_000 + firstLength, length: secondLength, durationTicks: 1_000 },
    ]);

    expect(groupAudioSidxReferences(index)?.map(({ offset, length }) => ({ offset, length }))).toEqual([
      { offset: 1_000, length: firstLength },
      { offset: 1_000 + firstLength, length: secondLength },
    ]);
    const playlist = createAudioVodPlaylist("video", index);
    expect(playlist).toContain(`#EXT-X-BYTERANGE:${firstLength}@1000`);
    expect(playlist).toContain(`#EXT-X-BYTERANGE:${secondLength}@${1_000 + firstLength}`);
    expect(playlist).not.toContain(`#EXT-X-BYTERANGE:${firstLength + secondLength}@1000`);
  });

  test("declines a fragment or initialization range that the existing proxy would truncate", () => {
    const oversizedReference = indexFor([
      { offset: 1_000, length: AUDIO_CHUNK_BYTES + 1, durationTicks: 1_000 },
    ]);
    expect(groupAudioSidxReferences(oversizedReference)).toBeNull();
    expect(createAudioVodPlaylist("video", oversizedReference)).toBeNull();

    const oversizedInitialization = indexFor([
      { offset: AUDIO_CHUNK_BYTES + 10, length: 10, durationTicks: 1_000 },
    ], {
      sidxOffset: AUDIO_CHUNK_BYTES + 1,
      initializationLength: AUDIO_CHUNK_BYTES + 1,
      firstMediaOffset: AUDIO_CHUNK_BYTES + 10,
    });
    expect(createAudioVodPlaylist("video", oversizedInitialization)).toBeNull();
  });

  test("declines non-contiguous references instead of publishing incorrect offsets", () => {
    const index = indexFor([
      { offset: 1_000, length: 100, durationTicks: 1_000 },
      { offset: 1_101, length: 100, durationTicks: 1_000 },
    ]);
    expect(groupAudioSidxReferences(index)).toBeNull();
    expect(createAudioVodPlaylist("video", index)).toBeNull();
  });
});
