import type { MediaSidxIndex, MediaSidxReference } from "./mediaSidx";

export const DIRECT_VIDEO_HLS_TARGET_SEGMENT_SECONDS = 6;
export const DIRECT_VIDEO_HLS_MAX_RANGE_BYTES = 32 * 1024 * 1024;
export const DIRECT_VIDEO_HLS_MAX_TIMELINE_DRIFT_SECONDS = 0.25;

export interface VideoVodMetadata {
  videoCodec: string;
  audioCodec: string;
  width: number;
  height: number;
  fps: number;
  videoBitrate: number;
  audioBitrate: number;
  audioChannels?: number | null;
}

export interface VideoVodPlaylistInput {
  videoId: string;
  /** Stable identity of the indexed representation, used to reject stale ranges. */
  resourceVersion?: string;
  video: MediaSidxIndex;
  audio: MediaSidxIndex;
  metadata: VideoVodMetadata;
}

export interface VideoVodSegment {
  offset: number;
  length: number;
  durationSeconds: number;
  firstReferenceIndex: number;
  referenceCount: number;
}

export interface VideoVodPresentation {
  masterPlaylist: string;
  videoPlaylist: string;
  audioPlaylist: string;
  targetDuration: number;
  segmentCount: number;
  videoDurationSeconds: number;
  audioDurationSeconds: number;
  videoSegments: VideoVodSegment[];
  audioSegments: VideoVodSegment[];
}

export type VideoVodPlaylistUnsupportedReason =
  | "invalid_metadata"
  | "invalid_video_index"
  | "invalid_audio_index"
  | "range_too_large"
  | "unsafe_video_boundary"
  | "incompatible_timeline";

export type VideoVodPlaylistResult =
  | { kind: "ok"; presentation: VideoVodPresentation }
  | { kind: "unsupported"; reason: VideoVodPlaylistUnsupportedReason };

interface Timeline {
  boundaries: number[];
  byteEnds: number[];
}

function unsupported(reason: VideoVodPlaylistUnsupportedReason): VideoVodPlaylistResult {
  return { kind: "unsupported", reason };
}

function safeSap(reference: MediaSidxReference): boolean {
  return reference.startsWithSap && (reference.sapType === 1 || reference.sapType === 2);
}

function validIndex(index: MediaSidxIndex): boolean {
  if (!Number.isSafeInteger(index.timescale) || index.timescale <= 0
    || !Number.isSafeInteger(index.earliestPresentationTime) || index.earliestPresentationTime < 0
    || !Number.isSafeInteger(index.sidxOffset) || index.sidxOffset <= 0
    || !Number.isSafeInteger(index.sidxLength) || index.sidxLength <= 0
    || index.sidxLength > Number.MAX_SAFE_INTEGER - index.sidxOffset
    || index.initializationLength !== index.sidxOffset
    || index.initializationLength > DIRECT_VIDEO_HLS_MAX_RANGE_BYTES
    || index.references.length === 0
    || !Number.isSafeInteger(index.firstMediaOffset)
    || index.firstMediaOffset < index.sidxOffset + index.sidxLength
    || index.firstMediaOffset !== index.references[0]?.offset) return false;

  let expectedOffset = index.firstMediaOffset;
  let durationTicks = 0;
  for (const reference of index.references) {
    if (!Number.isSafeInteger(reference.offset) || reference.offset !== expectedOffset
      || !Number.isSafeInteger(reference.length) || reference.length <= 0
      || reference.length > DIRECT_VIDEO_HLS_MAX_RANGE_BYTES
      || !Number.isSafeInteger(reference.durationTicks) || reference.durationTicks <= 0
      || typeof reference.startsWithSap !== "boolean"
      || !Number.isSafeInteger(reference.sapType) || reference.sapType < 0 || reference.sapType > 6
      || !Number.isSafeInteger(reference.sapDeltaTime) || reference.sapDeltaTime < 0 || reference.sapDeltaTime > 0x0fffffff
      || (reference.startsWithSap && (reference.sapType === 0 || reference.sapDeltaTime !== 0))
      || reference.length > Number.MAX_SAFE_INTEGER - expectedOffset
      || reference.durationTicks > Number.MAX_SAFE_INTEGER - durationTicks) return false;
    expectedOffset += reference.length;
    durationTicks += reference.durationTicks;
  }
  return true;
}

function timelineFor(index: MediaSidxIndex): Timeline | null {
  const start = index.earliestPresentationTime / index.timescale;
  if (!Number.isFinite(start)) return null;
  const boundaries = [start];
  const byteEnds = [0];
  let ticks = index.earliestPresentationTime;
  let bytes = 0;
  for (const reference of index.references) {
    if (reference.durationTicks > Number.MAX_SAFE_INTEGER - ticks
      || reference.length > Number.MAX_SAFE_INTEGER - bytes) return null;
    ticks += reference.durationTicks;
    bytes += reference.length;
    const time = ticks / index.timescale;
    if (!Number.isFinite(time) || time <= boundaries[boundaries.length - 1]) return null;
    boundaries.push(time);
    byteEnds.push(bytes);
  }
  return { boundaries, byteEnds };
}

function rangeLength(timeline: Timeline, start: number, end: number): number {
  return timeline.byteEnds[end] - timeline.byteEnds[start];
}

function groupedBoundaries(
  candidates: number[],
  timeline: Timeline,
): number[] | null {
  for (let position = 1; position < candidates.length; position += 1) {
    if (rangeLength(timeline, candidates[position - 1], candidates[position])
      > DIRECT_VIDEO_HLS_MAX_RANGE_BYTES) return null;
  }

  const grouped = [candidates[0]];
  let position = 0;
  while (position < candidates.length - 1) {
    const start = candidates[position];
    let best = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let candidate = position + 1; candidate < candidates.length; candidate += 1) {
      const end = candidates[candidate];
      if (rangeLength(timeline, start, end) > DIRECT_VIDEO_HLS_MAX_RANGE_BYTES) break;
      const duration = timeline.boundaries[end] - timeline.boundaries[start];
      const distance = Math.abs(duration - DIRECT_VIDEO_HLS_TARGET_SEGMENT_SECONDS);
      if (distance < bestDistance || (distance === bestDistance && candidate > best)) {
        best = candidate;
        bestDistance = distance;
      }
    }
    if (best < 0) return null;
    grouped.push(candidates[best]);
    position = best;
  }
  return grouped;
}

function segmentsFor(
  index: MediaSidxIndex,
  timeline: Timeline,
  boundaries: number[],
): VideoVodSegment[] {
  return boundaries.slice(1).map((boundary, position) => {
    const start = boundaries[position];
    const end = boundary;
    return {
      offset: index.references[start].offset,
      length: rangeLength(timeline, start, end),
      durationSeconds: timeline.boundaries[end] - timeline.boundaries[start],
      firstReferenceIndex: start,
      referenceCount: end - start,
    };
  });
}

function decimal(value: number, places = 12): string {
  return value.toFixed(places).replace(/0+$/, "").replace(/\.$/, "");
}

function mediaPlaylist(uri: string, index: MediaSidxIndex, segments: VideoVodSegment[], targetDuration: number): string {
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:7",
    "#EXT-X-PLAYLIST-TYPE:VOD",
    `#EXT-X-TARGETDURATION:${targetDuration}`,
    "#EXT-X-MEDIA-SEQUENCE:0",
    `#EXT-X-MAP:URI="${uri}",BYTERANGE="${index.initializationLength}@0"`,
  ];
  for (const segment of segments) lines.push(
    `#EXTINF:${decimal(segment.durationSeconds)},`,
    `#EXT-X-BYTERANGE:${segment.length}@${segment.offset}`,
    uri,
  );
  lines.push("#EXT-X-ENDLIST");
  return `${lines.join("\n")}\n`;
}

function validCodec(codec: string): boolean {
  return codec.length > 0 && codec.length <= 128 && /^[A-Za-z0-9._-]+$/.test(codec);
}

/** Build aligned, direct fMP4 HLS playlists without transcoding either representation. */
export function createVideoVodPresentation(input: VideoVodPlaylistInput): VideoVodPlaylistResult {
  const { metadata } = input;
  if (!input.videoId || !validCodec(metadata.videoCodec) || !validCodec(metadata.audioCodec)
    || !Number.isSafeInteger(metadata.width) || metadata.width <= 0
    || !Number.isSafeInteger(metadata.height) || metadata.height <= 0
    || !Number.isFinite(metadata.fps) || metadata.fps <= 0
    || !Number.isFinite(metadata.videoBitrate) || metadata.videoBitrate <= 0
    || !Number.isFinite(metadata.audioBitrate) || metadata.audioBitrate <= 0
    || metadata.videoBitrate > Number.MAX_SAFE_INTEGER - metadata.audioBitrate
    || (metadata.audioChannels != null
      && (!Number.isSafeInteger(metadata.audioChannels) || metadata.audioChannels <= 0))) return unsupported("invalid_metadata");
  if (!validIndex(input.video)) return unsupported("invalid_video_index");
  if (!validIndex(input.audio)) return unsupported("invalid_audio_index");
  if (!safeSap(input.video.references[0])) return unsupported("unsafe_video_boundary");

  const videoTimeline = timelineFor(input.video);
  const audioTimeline = timelineFor(input.audio);
  if (!videoTimeline || !audioTimeline) return unsupported("incompatible_timeline");
  const videoEnd = input.video.references.length;
  const audioEnd = input.audio.references.length;
  if (Math.abs(videoTimeline.boundaries[0] - audioTimeline.boundaries[0])
      > DIRECT_VIDEO_HLS_MAX_TIMELINE_DRIFT_SECONDS
    || Math.abs(videoTimeline.boundaries[videoEnd] - audioTimeline.boundaries[audioEnd])
      > DIRECT_VIDEO_HLS_MAX_TIMELINE_DRIFT_SECONDS) return unsupported("incompatible_timeline");

  // Alternate HLS renditions share a timestamp timeline; they do not need
  // identical segment boundaries. YouTube commonly indexes video near 6 s
  // and audio near 10 s, so forcing a common boundary would create ~30 s
  // byte ranges and reject otherwise valid high-bitrate representations.
  const videoCandidates = [
    0,
    ...input.video.references.flatMap((reference, index) => (
      index > 0 && safeSap(reference) ? [index] : []
    )),
    videoEnd,
  ];
  const audioCandidates = Array.from({ length: audioEnd + 1 }, (_, index) => index);
  const videoGroups = groupedBoundaries(videoCandidates, videoTimeline);
  const audioGroups = groupedBoundaries(audioCandidates, audioTimeline);
  if (!videoGroups || !audioGroups) return unsupported("range_too_large");
  const videoSegments = segmentsFor(input.video, videoTimeline, videoGroups);
  const audioSegments = segmentsFor(input.audio, audioTimeline, audioGroups);
  if (videoSegments.length === 0) return unsupported("incompatible_timeline");

  const targetDuration = Math.ceil(Math.max(
    ...videoSegments.map((segment) => segment.durationSeconds),
    ...audioSegments.map((segment) => segment.durationSeconds),
  ));
  const bandwidth = Math.ceil(metadata.videoBitrate + metadata.audioBitrate);
  if (!Number.isSafeInteger(targetDuration) || targetDuration <= 0
    || !Number.isSafeInteger(bandwidth) || bandwidth <= 0) return unsupported("invalid_metadata");

  let baseUri: string;
  try {
    baseUri = `/api/videos/${encodeURIComponent(input.videoId)}/hls`;
  } catch {
    return unsupported("invalid_metadata");
  }
  if (input.resourceVersion != null && !/^[A-Za-z0-9_-]{8,128}$/.test(input.resourceVersion)) {
    return unsupported("invalid_metadata");
  }
  const query = input.resourceVersion ? `?v=${encodeURIComponent(input.resourceVersion)}` : "";
  const videoUri = `${baseUri}/video.mp4${query}`;
  const audioUri = `${baseUri}/audio.mp4${query}`;
  const channels = metadata.audioChannels == null ? "" : `,CHANNELS="${metadata.audioChannels}"`;
  const masterPlaylist = [
    "#EXTM3U",
    "#EXT-X-VERSION:7",
    `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Default",DEFAULT=YES,AUTOSELECT=YES,URI="${baseUri}/audio.m3u8${query}"${channels}`,
    `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},CODECS="${metadata.videoCodec},${metadata.audioCodec}",RESOLUTION=${metadata.width}x${metadata.height},FRAME-RATE=${decimal(metadata.fps, 3)},AUDIO="audio"`,
    `${baseUri}/video.m3u8${query}`,
    "",
  ].join("\n");
  return {
    kind: "ok",
    presentation: {
      masterPlaylist,
      videoPlaylist: mediaPlaylist(videoUri, input.video, videoSegments, targetDuration),
      audioPlaylist: mediaPlaylist(audioUri, input.audio, audioSegments, targetDuration),
      targetDuration,
      segmentCount: videoSegments.length,
      videoDurationSeconds: videoTimeline.boundaries.at(-1)! - videoTimeline.boundaries[0],
      audioDurationSeconds: audioTimeline.boundaries.at(-1)! - audioTimeline.boundaries[0],
      videoSegments,
      audioSegments,
    },
  };
}
