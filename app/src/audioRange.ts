export const AUDIO_CHUNK_BYTES = 8_388_608;

export interface AudioByteRange {
  start: number;
  end: number;
  /** Whether the client supplied a Range header. */
  requested: boolean;
}

export interface AudioContentRange {
  start: number;
  end: number;
  total: number;
}

/**
 * Normalize one explicit byte range into a bounded upstream request. A missing
 * Range starts with the first bounded chunk. Suffix and multipart ranges are
 * rejected explicitly because converting them correctly requires knowing the
 * representation length before issuing the media request.
 */
export function parseAudioRange(value: string | null, chunkBytes = AUDIO_CHUNK_BYTES): AudioByteRange | null {
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes <= 0) return null;
  if (value == null) return { start: 0, end: chunkBytes - 1, requested: false };

  const match = value.trim().match(/^bytes=(\d+)-(\d*)$/i);
  if (!match) return null;
  const start = Number(match[1]);
  if (!Number.isSafeInteger(start) || start < 0) return null;

  const maximumChunkEnd = Math.min(Number.MAX_SAFE_INTEGER, start + chunkBytes - 1);
  const requestedEnd = match[2] ? Number(match[2]) : maximumChunkEnd;
  if (!Number.isSafeInteger(requestedEnd) || requestedEnd < start) return null;
  return { start, end: Math.min(requestedEnd, maximumChunkEnd), requested: true };
}

/** Parse a satisfied single-range Content-Range returned by the media host. */
export function parseAudioContentRange(value: string | null): AudioContentRange | null {
  const match = value?.trim().match(/^bytes (\d+)-(\d+)\/(\d+)$/i);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  if (![start, end, total].every(Number.isSafeInteger)) return null;
  if (start < 0 || end < start || total <= end) return null;
  return { start, end, total };
}

/** Parse the representation length from an unsatisfied Content-Range. */
export function parseAudioUnsatisfiedTotal(value: string | null): number | null {
  const match = value?.trim().match(/^bytes \*\/(\d+)$/i);
  if (!match) return null;
  const total = Number(match[1]);
  return Number.isSafeInteger(total) && total >= 0 ? total : null;
}

/** Validate the status and framing headers of one upstream range response. */
export function validateAudioRangeResponse(
  status: number,
  contentRangeValue: string | null,
  contentLengthValue: string | null,
  requested: AudioByteRange,
): AudioContentRange | null {
  if (status !== 206 || !contentLengthValue || !/^\d+$/.test(contentLengthValue)) return null;
  const contentRange = parseAudioContentRange(contentRangeValue);
  if (!contentRange) return null;
  if (contentRange.start !== requested.start) return null;
  if (contentRange.end !== Math.min(requested.end, contentRange.total - 1)) return null;
  const contentLength = Number(contentLengthValue);
  const expectedLength = contentRange.end - contentRange.start + 1;
  if (!Number.isSafeInteger(contentLength) || contentLength !== expectedLength) return null;
  return contentRange;
}

export function audioRangeHeader(range: AudioByteRange): string {
  return `bytes=${range.start}-${range.end}`;
}
