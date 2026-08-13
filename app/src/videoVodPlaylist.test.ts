import { describe, expect, test } from "bun:test";
import type { MediaSidxIndex, MediaSidxReference } from "./mediaSidx";
import {
  createVideoVodPresentation,
  DIRECT_VIDEO_HLS_MAX_RANGE_BYTES,
  type VideoVodPlaylistInput,
} from "./videoVodPlaylist";

interface ReferenceInput {
  duration: number;
  length?: number;
  sap?: 0 | 1 | 2;
}

function mediaIndex(
  inputs: ReferenceInput[],
  overrides: Partial<MediaSidxIndex> = {},
): MediaSidxIndex {
  let offset = overrides.firstMediaOffset ?? 1_000;
  const references: MediaSidxReference[] = inputs.map((input) => {
    const length = input.length ?? 100;
    const reference = {
      offset,
      length,
      durationTicks: input.duration,
      startsWithSap: input.sap != null && input.sap !== 0,
      sapType: input.sap ?? 0,
      sapDeltaTime: 0,
    };
    offset += length;
    return reference;
  });
  return {
    version: 0,
    timescale: 1_000,
    earliestPresentationTime: 0,
    sidxOffset: 700,
    sidxLength: 300,
    initializationLength: 700,
    firstMediaOffset: 1_000,
    references,
    ...overrides,
  };
}

function input(overrides: Partial<VideoVodPlaylistInput> = {}): VideoVodPlaylistInput {
  return {
    videoId: "video/id",
    video: mediaIndex([
      { duration: 2_000, length: 1_000, sap: 1 },
      { duration: 2_000, length: 1_100, sap: 0 },
      { duration: 2_000, length: 1_200, sap: 2 },
      { duration: 2_000, length: 1_300, sap: 0 },
      { duration: 2_000, length: 1_400, sap: 1 },
      { duration: 2_000, length: 1_500, sap: 0 },
    ]),
    audio: mediaIndex(Array.from({ length: 12 }, (_, index) => ({
      duration: 1_000,
      length: 100 + index,
      sap: 1 as const,
    })), { firstMediaOffset: 3_000 }),
    metadata: {
      videoCodec: "avc1.640028",
      audioCodec: "mp4a.40.2",
      width: 1920,
      height: 1080,
      fps: 29.97,
      videoBitrate: 4_500_000,
      audioBitrate: 128_000,
      audioChannels: 2,
    },
    ...overrides,
  };
}

describe("direct video fMP4 VOD playlists", () => {
  test("groups each rendition on its natural boundaries and emits a complete master presentation", () => {
    const result = createVideoVodPresentation(input());
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const { presentation } = result;

    expect(presentation.segmentCount).toBe(2);
    expect(presentation.targetDuration).toBe(8);
    expect(presentation.videoSegments.map(({ firstReferenceIndex, referenceCount }) => (
      { firstReferenceIndex, referenceCount }
    ))).toEqual([
      { firstReferenceIndex: 0, referenceCount: 4 },
      { firstReferenceIndex: 4, referenceCount: 2 },
    ]);
    expect(presentation.audioSegments.map(({ firstReferenceIndex, referenceCount }) => (
      { firstReferenceIndex, referenceCount }
    ))).toEqual([
      { firstReferenceIndex: 0, referenceCount: 6 },
      { firstReferenceIndex: 6, referenceCount: 6 },
    ]);

    expect(presentation.masterPlaylist).toBe([
      "#EXTM3U",
      "#EXT-X-VERSION:7",
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Default",DEFAULT=YES,AUTOSELECT=YES,URI="/api/videos/video%2Fid/hls/audio.m3u8",CHANNELS="2"',
      '#EXT-X-STREAM-INF:BANDWIDTH=4628000,CODECS="avc1.640028,mp4a.40.2",RESOLUTION=1920x1080,FRAME-RATE=29.97,AUDIO="audio"',
      "/api/videos/video%2Fid/hls/video.m3u8",
      "",
    ].join("\n"));
    expect(presentation.videoPlaylist).toBe([
      "#EXTM3U", "#EXT-X-VERSION:7", "#EXT-X-PLAYLIST-TYPE:VOD",
      "#EXT-X-TARGETDURATION:8", "#EXT-X-MEDIA-SEQUENCE:0",
      '#EXT-X-MAP:URI="/api/videos/video%2Fid/hls/video.mp4",BYTERANGE="700@0"',
      "#EXTINF:8,", "#EXT-X-BYTERANGE:4600@1000", "/api/videos/video%2Fid/hls/video.mp4",
      "#EXTINF:4,", "#EXT-X-BYTERANGE:2900@5600", "/api/videos/video%2Fid/hls/video.mp4",
      "#EXT-X-ENDLIST", "",
    ].join("\n"));
    expect(presentation.audioPlaylist).toBe([
      "#EXTM3U", "#EXT-X-VERSION:7", "#EXT-X-PLAYLIST-TYPE:VOD",
      "#EXT-X-TARGETDURATION:8", "#EXT-X-MEDIA-SEQUENCE:0",
      '#EXT-X-MAP:URI="/api/videos/video%2Fid/hls/audio.mp4",BYTERANGE="700@0"',
      "#EXTINF:6,", "#EXT-X-BYTERANGE:615@3000", "/api/videos/video%2Fid/hls/audio.mp4",
      "#EXTINF:6,", "#EXT-X-BYTERANGE:651@3615", "/api/videos/video%2Fid/hls/audio.mp4",
      "#EXT-X-ENDLIST", "",
    ].join("\n"));
  });

  test("rejects video whose first fragment is not a SAP type 1 or 2", () => {
    const unsafe = input({
      video: mediaIndex([
        { duration: 6_000, sap: 0 },
        { duration: 6_000, sap: 1 },
      ]),
      audio: mediaIndex([{ duration: 6_000, sap: 1 }, { duration: 6_000, sap: 1 }]),
    });
    expect(createVideoVodPresentation(unsafe))
      .toEqual({ kind: "unsupported", reason: "unsafe_video_boundary" });
  });

  test("does not publish a non-SAP internal video boundary", () => {
    const result = createVideoVodPresentation(input({
      video: mediaIndex([
        { duration: 2_000, sap: 1 }, { duration: 2_000, sap: 0 },
        { duration: 2_000, sap: 0 }, { duration: 2_000, sap: 0 },
        { duration: 2_000, sap: 1 }, { duration: 2_000, sap: 0 },
      ]),
      audio: mediaIndex(Array.from({ length: 6 }, () => ({ duration: 2_000, sap: 1 as const }))),
    }));
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.presentation.videoSegments).toHaveLength(2);
    expect(result.presentation.videoSegments[0].referenceCount).toBe(4);
    expect(result.presentation.videoSegments[1].firstReferenceIndex).toBe(4);
  });

  test("keeps YouTube-shaped 6-second video and 10-second audio on the direct path", () => {
    const videoCount = 3_119;
    const audioCount = 1_875;
    const totalTicks = videoCount * 6_000;
    const audioBase = Math.floor(totalTicks / audioCount);
    const audioRemainder = totalTicks - audioBase * audioCount;
    const result = createVideoVodPresentation(input({
      video: mediaIndex(Array.from({ length: videoCount }, () => ({
        duration: 6_000,
        length: 8 * 1024 * 1024,
        sap: 1 as const,
      }))),
      audio: mediaIndex(Array.from({ length: audioCount }, (_, index) => ({
        duration: audioBase + (index < audioRemainder ? 1 : 0),
        length: 256 * 1024,
        sap: 1 as const,
      })), { firstMediaOffset: 3_000 }),
    }));

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.presentation.videoSegments).toHaveLength(videoCount);
    expect(result.presentation.audioSegments).toHaveLength(audioCount);
    expect(result.presentation.targetDuration).toBe(10);
    expect(Math.max(...result.presentation.videoSegments.map(({ length }) => length)))
      .toBeLessThanOrEqual(DIRECT_VIDEO_HLS_MAX_RANGE_BYTES);
  });

  test("rejects materially incompatible starts or total durations", () => {
    const shifted = createVideoVodPresentation(input({
      audio: mediaIndex([{ duration: 6_000, sap: 1 }, { duration: 6_000, sap: 1 }], {
        earliestPresentationTime: 500,
      }),
      video: mediaIndex([{ duration: 6_000, sap: 1 }, { duration: 6_000, sap: 1 }]),
    }));
    expect(shifted).toEqual({ kind: "unsupported", reason: "incompatible_timeline" });

    const shorter = createVideoVodPresentation(input({
      video: mediaIndex([{ duration: 6_000, sap: 1 }, { duration: 6_000, sap: 1 }]),
      audio: mediaIndex([{ duration: 6_000, sap: 1 }, { duration: 5_000, sap: 1 }]),
    }));
    expect(shorter).toEqual({ kind: "unsupported", reason: "incompatible_timeline" });
  });

  test("rejects an oversized init, source fragment or aligned group", () => {
    const oversizedInit = input({
      video: mediaIndex([{ duration: 12_000, sap: 1 }], {
        sidxOffset: DIRECT_VIDEO_HLS_MAX_RANGE_BYTES + 1,
        initializationLength: DIRECT_VIDEO_HLS_MAX_RANGE_BYTES + 1,
      }),
      audio: mediaIndex([{ duration: 12_000, sap: 1 }]),
    });
    expect(createVideoVodPresentation(oversizedInit))
      .toEqual({ kind: "unsupported", reason: "invalid_video_index" });

    const oversizedFragment = input({
      video: mediaIndex([{ duration: 12_000, length: DIRECT_VIDEO_HLS_MAX_RANGE_BYTES + 1, sap: 1 }]),
      audio: mediaIndex([{ duration: 12_000, sap: 1 }]),
    });
    expect(createVideoVodPresentation(oversizedFragment))
      .toEqual({ kind: "unsupported", reason: "invalid_video_index" });

    const oversizedGroup = input({
      video: mediaIndex([
        { duration: 4_000, length: 17 * 1024 * 1024, sap: 1 },
        { duration: 4_000, length: 17 * 1024 * 1024, sap: 0 },
        { duration: 4_000, length: 1_000, sap: 1 },
      ]),
      audio: mediaIndex([{ duration: 8_000, sap: 1 }, { duration: 4_000, sap: 1 }]),
    });
    expect(createVideoVodPresentation(oversizedGroup))
      .toEqual({ kind: "unsupported", reason: "range_too_large" });
  });

  test("omits CHANNELS when the resolver has no valid channel count", () => {
    const value = input();
    value.metadata.audioChannels = null;
    const result = createVideoVodPresentation(value);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.presentation.masterPlaylist).not.toContain("CHANNELS=");
  });
});
