import { storedUtcTimestampMs } from "./timeZone";

export const RECOMMENDATION_COMPLETE_RATIO = 0.92;

export type RecommendationTimeOfDay = "night" | "morning" | "afternoon" | "evening";

export interface RecommendationCandidate {
  video_id: string;
  channel_id: string;
  published_at?: string | null;
  live_status?: string | null;
  status?: string | null;
  is_short?: number | null;
  is_private?: number | null;
  watched?: number | null;
  liked?: number | null;
  in_history?: number | boolean | null;
  watch_position?: number | null;
  watch_duration?: number | null;
  external?: number | null;
  tag_hits?: number | null;
  tag_watch_count?: number | null;
  tag_time_seconds?: number | null;
  channel_watch_count?: number | null;
  channel_watch_seconds?: number | null;
  channel_time_seconds?: number | null;
  playlist_hits?: number | null;
}

export interface RankedRecommendation<T extends RecommendationCandidate = RecommendationCandidate> {
  kind: "local" | "external";
  score: number;
  reasons: string[];
  video?: T;
  result?: unknown;
  query?: string;
}

export function recommendationTimeOfDay(hour: number): RecommendationTimeOfDay {
  const normalized = ((Math.floor(hour) % 24) + 24) % 24;
  if (normalized < 5) return "night";
  if (normalized < 12) return "morning";
  if (normalized < 17) return "afternoon";
  return "evening";
}

export function recommendationHoursNear(hour: number): number[] {
  const normalized = ((Math.floor(hour) % 24) + 24) % 24;
  return [(normalized + 23) % 24, normalized, (normalized + 1) % 24];
}

/** A real continuation starts after three seconds and stops before the same
 * completion threshold used by the in-progress shelf. */
export function recommendationProgress(candidate: Pick<RecommendationCandidate, "watch_position" | "watch_duration">): number | null {
  const position = Number(candidate.watch_position);
  const duration = Number(candidate.watch_duration);
  if (!Number.isFinite(position) || !Number.isFinite(duration) || duration <= 30 || position < 3) return null;
  return Math.max(0, position / duration);
}

export function isEligibleRecommendation(candidate: RecommendationCandidate): boolean {
  // `is_short = NULL` means metadata has not been checked yet. Recommendations
  // deliberately require a confirmed regular video so a Short cannot leak in.
  if (candidate.is_short !== 0) return false;
  // Archived streams (`was_live`) are excluded together with live/upcoming.
  if (candidate.live_status !== "none") return false;
  if (candidate.is_private === 1 || candidate.status === "archived" || candidate.watched === 1) return false;
  const progress = recommendationProgress(candidate);
  return progress == null || progress < RECOMMENDATION_COMPLETE_RATIO;
}

function numeric(value: number | null | undefined) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

/** Score one local candidate from Pulse data and the broader profile history.
 * The ordering is explicit: tags watched around the current hour, then channels
 * watched around that hour, then general affinities and supporting signals. */
export function scoreRecommendationCandidate<T extends RecommendationCandidate>(
  video: T,
  settings: Record<string, number>,
  nowMs = Date.now(),
): RankedRecommendation<T> | null {
  if (!isEligibleRecommendation(video)) return null;

  let score = 0;
  const reasons: string[] = [];
  const add = (points: number, reason: string) => {
    if (!Number.isFinite(points) || points <= 0) return;
    score += points;
    reasons.push(reason);
  };

  // Pulse stores heartbeat seconds per tag and hour. Large tier bases encode a
  // lexicographic preference without adding another persistent user setting:
  // any current-hour tag match outranks a channel-only time match, which in
  // turn outranks general history and helper signals.
  const tagPulseSeconds = numeric(video.tag_time_seconds);
  if (tagPulseSeconds > 0) {
    add(10_000 + Math.min(500, Math.log1p(tagPulseSeconds / 60) * 90), "time-matched tags");
    reasons.push("time of day");
  }

  const channelPulseSeconds = numeric(video.channel_time_seconds);
  if (channelPulseSeconds > 0) {
    add(5_000 + Math.min(250, Math.log1p(channelPulseSeconds / 60) * 45), "time-matched channel");
    reasons.push("time of day");
  }

  // General tag affinity is the fallback when Pulse has too little data for
  // this hour, and remains stronger than general channel affinity by default.
  const tagPriorityMultiplier = 2;
  const tagHits = numeric(video.tag_hits);
  const tagHistory = numeric(video.tag_watch_count);
  const generalTagPoints = (
    tagHits * numeric(settings.shared_tag_points)
    + Math.min(numeric(settings.tag_history_cap), tagHistory * numeric(settings.tag_history_points))
  ) * tagPriorityMultiplier;
  add(Math.min(1_000, generalTagPoints), "shared tags");
  if (tagHistory > 0 && generalTagPoints > 0) reasons.push("watched tag history");

  // Prefer actual time where it exists, but keep imported history useful when
  // old backups do not contain heartbeat data.
  const channelHistory = numeric(video.channel_watch_count);
  const channelTimeUnits = Math.log1p(numeric(video.channel_watch_seconds) / 600);
  const channelAffinity = Math.max(channelHistory, channelTimeUnits);
  add(
    Math.min(numeric(settings.watched_channel_cap), channelAffinity * numeric(settings.watched_channel_points)),
    "watched channel",
  );

  add(numeric(video.playlist_hits) > 0 ? numeric(settings.playlist_points) : 0, "in your playlists");
  add(video.liked === 1 ? numeric(settings.liked_points) : 0, "liked");

  const progress = recommendationProgress(video);
  if (progress != null && progress < RECOMMENDATION_COMPLETE_RATIO) {
    // A meaningful continuation gets stronger as the viewer gets further in,
    // without crowding out every fresh recommendation.
    add(numeric(settings.started_points) * (0.65 + Math.min(progress, 1) * 0.7), "started watching");
  } else if (video.in_history) {
    // An opened video with no reliable progress remains a weak signal only.
    add(numeric(settings.already_watched_points) * 0.25, "opened before");
  }

  if (video.external === 1 && Number.isFinite(Number(settings.external_adjustment))) {
    score += Number(settings.external_adjustment);
    reasons.push("temporary source");
  }

  const publishedAt = video.published_at ? storedUtcTimestampMs(video.published_at) : Number.NaN;
  const ageDays = Number.isFinite(publishedAt) ? Math.max(0, (nowMs - publishedAt) / 86_400_000) : 90;
  add(Math.max(0, numeric(settings.recency_points) - Math.floor(ageDays / 7)), "recent");

  if (!Number.isFinite(score) || score <= 0) return null;
  return { kind: "local", score, reasons: [...new Set(reasons)], video };
}

function recommendationId(item: RankedRecommendation) {
  return item.video?.video_id ?? "";
}

function recommendationChannel(item: RankedRecommendation) {
  return item.video?.channel_id ?? "";
}

function publishedAt(item: RankedRecommendation) {
  const value = item.video?.published_at;
  return value ? storedUtcTimestampMs(value) : 0;
}

export function compareRecommendations(a: RankedRecommendation, b: RankedRecommendation) {
  return b.score - a.score
    || publishedAt(b) - publishedAt(a)
    || recommendationId(a).localeCompare(recommendationId(b));
}

/** Deterministic greedy diversification. Repeated channels receive a bounded
 * penalty before the hard per-channel cap, so the list stays varied without
 * changing order randomly between page loads. */
export function diversifyRecommendations<T extends RankedRecommendation>(
  input: T[],
  limit: number,
  perChannel: number,
): T[] {
  const seen = new Set<string>();
  const pool = input
    .filter((item) => {
      const id = recommendationId(item);
      if (!id || seen.has(id) || !item.video || !isEligibleRecommendation(item.video)) return false;
      seen.add(id);
      return true;
    })
    .sort(compareRecommendations) as T[];

  const out: T[] = [];
  const channelCounts = new Map<string, number>();
  const safeLimit = Math.max(0, Math.floor(limit));
  const channelLimit = Math.max(1, Math.floor(perChannel));
  const diversityPenalty = Math.max(4, (pool[0]?.score ?? 0) * 0.08);

  while (pool.length > 0 && out.length < safeLimit) {
    let bestIndex = -1;
    let bestAdjusted = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < pool.length; index++) {
      const channel = recommendationChannel(pool[index]);
      const repeats = channelCounts.get(channel) ?? 0;
      if (repeats >= channelLimit) continue;
      const adjusted = pool[index].score - repeats * diversityPenalty;
      if (adjusted > bestAdjusted) {
        bestAdjusted = adjusted;
        bestIndex = index;
      }
    }
    if (bestIndex < 0) break;
    const [picked] = pool.splice(bestIndex, 1);
    out.push(picked);
    const channel = recommendationChannel(picked);
    channelCounts.set(channel, (channelCounts.get(channel) ?? 0) + 1);
  }
  return out;
}
