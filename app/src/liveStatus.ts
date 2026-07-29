import type { LiveInfo, ScrapedVideo } from "./youtube";

export type ActiveLivestream = {
  videoId: string;
  title: string;
  thumbnail: string;
  status: "live" | "upcoming";
};

/**
 * Combine the single /live result with the complete /streams listing.
 * `undefined` means that a source failed, while `null` means /live
 * authoritatively reported that the channel has no primary broadcast.
 */
export function resolveActiveLivestreams(
  primary: LiveInfo | null | undefined,
  streams: ScrapedVideo[] | undefined,
): { active: ActiveLivestream[]; canDemoteMissing: boolean } {
  const active = new Map<string, ActiveLivestream>();
  const streamLives = streams?.filter((stream) => stream.isLive) ?? [];

  for (const stream of streamLives) {
    active.set(stream.videoId, {
      videoId: stream.videoId,
      title: stream.title,
      thumbnail: stream.thumbnail,
      status: "live",
    });
  }

  if (primary) {
    active.set(primary.videoId, {
      videoId: primary.videoId,
      title: primary.title,
      thumbnail: primary.thumbnail,
      status: primary.isLiveNow ? "live" : "upcoming",
    });
  }

  // A successful streams listing containing live cards is authoritative for
  // multi-stream channels. An explicit no-live result from /live is also
  // authoritative. If /live found a broadcast but /streams failed or parsed
  // no live cards, keep previously known siblings instead of falsely ending
  // them after a transient/markup failure.
  const canDemoteMissing = primary === null || streamLives.length > 0;
  return { active: [...active.values()], canDemoteMissing };
}
