import type { SponsorSegment } from "./api";

export function normalizeSponsorSegments(videoId: string, segments: SponsorSegment[]): SponsorSegment[] {
  return segments.flatMap((segment, index) => {
    const start = Number(segment.segment?.[0]);
    const end = Number(segment.segment?.[1]);
    if (segment.actionType !== "skip" || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
    const apiUuid = segment.UUID || (segment as SponsorSegment & { uuid?: string }).uuid;
    return [{
      ...segment,
      segment: [start, end] as [number, number],
      UUID: apiUuid || `${videoId}:${segment.category}:${start}:${end}:${index}`,
    }];
  });
}
