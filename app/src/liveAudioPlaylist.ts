interface SegmentBlock {
  lines: string[];
  discontinuities: number;
}

const GLOBAL_TAGS = [
  "#EXT-X-VERSION:",
  "#EXT-X-TARGETDURATION:",
  "#EXT-X-INDEPENDENT-SEGMENTS",
  "#EXT-X-PLAYLIST-TYPE:",
  "#EXT-X-SERVER-CONTROL:",
  "#EXT-X-PART-INF:",
  "#EXT-X-START:",
  "#EXT-X-DEFINE:",
];

function rewriteTagUris(line: string, rewriteUri: (uri: string) => string | null): string | null {
  let valid = true;
  const rewritten = line.replace(/URI="([^"]+)"/g, (_match, uri: string) => {
    const replacement = rewriteUri(uri);
    if (!replacement) { valid = false; return uri; }
    return `URI="${replacement}"`;
  });
  return valid ? rewritten : null;
}

/** Keep a small live edge while preserving the sequence counters HLS clients use. */
export function rewriteLiveAudioPlaylist(
  source: string,
  maxSegments: number,
  rewriteUri: (uri: string) => string | null,
): string | null {
  const input = source.split(/\r?\n/);
  if (input[0]?.trim() !== "#EXTM3U" || maxSegments < 1) return null;
  if (input.some((line) => line.startsWith("#EXT-X-STREAM-INF") || line.startsWith("#EXT-X-ENDLIST"))) return null;

  let mediaSequence = 0;
  let discontinuitySequence = 0;
  const globals = ["#EXTM3U"];
  const segments: SegmentBlock[] = [];
  let pending: string[] = [];

  for (const rawLine of input.slice(1)) {
    const line = rawLine.trim();
    if (!line) continue;
    const mediaMatch = line.match(/^#EXT-X-MEDIA-SEQUENCE:(\d+)$/);
    if (mediaMatch) { mediaSequence = Number(mediaMatch[1]); continue; }
    const discontinuityMatch = line.match(/^#EXT-X-DISCONTINUITY-SEQUENCE:(\d+)$/);
    if (discontinuityMatch) { discontinuitySequence = Number(discontinuityMatch[1]); continue; }

    if (!segments.length && !pending.length && GLOBAL_TAGS.some((tag) => line.startsWith(tag))) {
      globals.push(line);
      continue;
    }
    if (line.startsWith("#")) {
      pending.push(line);
      continue;
    }
    pending.push(line);
    segments.push({
      lines: pending,
      discontinuities: pending.filter((entry) => entry === "#EXT-X-DISCONTINUITY").length,
    });
    pending = [];
  }
  if (!segments.length) return null;

  const dropped = Math.max(0, segments.length - maxSegments);
  const retained = segments.slice(dropped);
  const droppedDiscontinuities = segments.slice(0, dropped)
    .reduce((total, segment) => total + segment.discontinuities, 0);
  const output = [
    ...globals,
    `#EXT-X-MEDIA-SEQUENCE:${mediaSequence + dropped}`,
    `#EXT-X-DISCONTINUITY-SEQUENCE:${discontinuitySequence + droppedDiscontinuities}`,
  ];

  for (const segment of retained) {
    for (const line of segment.lines) {
      if (!line.startsWith("#")) {
        const rewritten = rewriteUri(line);
        if (!rewritten) return null;
        output.push(rewritten);
        continue;
      }
      const rewritten = rewriteTagUris(line, rewriteUri);
      if (!rewritten) return null;
      output.push(rewritten);
    }
  }
  return `${output.join("\n")}\n`;
}
