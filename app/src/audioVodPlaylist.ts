import { AUDIO_CHUNK_BYTES } from "./audioRange";
import type { AudioSidxIndex } from "./audioSidx";

export const AUDIO_VOD_TARGET_SEGMENT_SECONDS = 10;

export interface AudioVodSegment {
  offset: number;
  length: number;
  durationTicks: number;
  durationSeconds: number;
}

/** Group contiguous source fragments into HLS segments without exceeding the proxy's range limit. */
export function groupAudioSidxReferences(index: AudioSidxIndex): AudioVodSegment[] | null {
  if (!Number.isSafeInteger(index.timescale) || index.timescale <= 0 || index.references.length === 0) return null;
  const targetTicks = index.timescale * AUDIO_VOD_TARGET_SEGMENT_SECONDS;
  if (!Number.isSafeInteger(targetTicks)) return null;

  const segments: AudioVodSegment[] = [];
  let offset = 0;
  let length = 0;
  let durationTicks = 0;
  let expectedOffset = index.firstMediaOffset;

  const flush = () => {
    if (length === 0) return;
    segments.push({ offset, length, durationTicks, durationSeconds: durationTicks / index.timescale });
    length = 0;
    durationTicks = 0;
  };

  for (const reference of index.references) {
    if (!Number.isSafeInteger(reference.offset) || reference.offset !== expectedOffset) return null;
    if (!Number.isSafeInteger(reference.length) || reference.length <= 0 || reference.length > AUDIO_CHUNK_BYTES) return null;
    if (!Number.isSafeInteger(reference.durationTicks) || reference.durationTicks <= 0) return null;
    if (reference.offset > Number.MAX_SAFE_INTEGER - reference.length) return null;

    if (length > 0 && length + reference.length > AUDIO_CHUNK_BYTES) flush();
    if (length === 0) offset = reference.offset;
    length += reference.length;
    if (durationTicks > Number.MAX_SAFE_INTEGER - reference.durationTicks) return null;
    durationTicks += reference.durationTicks;
    expectedOffset = reference.offset + reference.length;
    if (durationTicks >= targetTicks) flush();
  }
  flush();
  return segments.length > 0 ? segments : null;
}

function decimalDuration(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return seconds.toFixed(12).replace(/0+$/, "").replace(/\.$/, "");
}

/** Build a same-origin, byte-range VOD playlist over the existing audio proxy. */
export function createAudioVodPlaylist(videoId: string, index: AudioSidxIndex): string | null {
  if (!Number.isSafeInteger(index.initializationLength)
    || index.initializationLength <= 0
    || index.initializationLength !== index.sidxOffset
    || index.initializationLength > AUDIO_CHUNK_BYTES) return null;

  const segments = groupAudioSidxReferences(index);
  if (!segments) return null;
  const targetDuration = segments.reduce(
    (maximum, segment) => Math.max(maximum, Math.ceil(segment.durationSeconds)),
    0,
  );
  if (!Number.isSafeInteger(targetDuration) || targetDuration <= 0) return null;

  let uri: string;
  try {
    uri = `/api/videos/${encodeURIComponent(videoId)}/audio`;
  } catch {
    return null;
  }
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:7",
    "#EXT-X-PLAYLIST-TYPE:VOD",
    `#EXT-X-TARGETDURATION:${targetDuration}`,
    `#EXT-X-MAP:URI="${uri}",BYTERANGE="${index.initializationLength}@0"`,
  ];
  for (const segment of segments) {
    const duration = decimalDuration(segment.durationSeconds);
    if (!duration) return null;
    lines.push(
      `#EXTINF:${duration},`,
      `#EXT-X-BYTERANGE:${segment.length}@${segment.offset}`,
      uri,
    );
  }
  lines.push("#EXT-X-ENDLIST");
  return `${lines.join("\n")}\n`;
}
