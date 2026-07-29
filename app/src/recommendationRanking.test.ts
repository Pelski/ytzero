import { describe, expect, test } from "bun:test";
import {
  diversifyRecommendations,
  isEligibleRecommendation,
  recommendationHoursNear,
  recommendationProgress,
  recommendationTimeOfDay,
  scoreRecommendationCandidate,
  type RecommendationCandidate,
  type RankedRecommendation,
} from "./recommendationRanking";

const candidate = (patch: Partial<RecommendationCandidate> = {}): RecommendationCandidate => ({
  video_id: "video-a",
  channel_id: "channel-a",
  published_at: "2026-07-28 12:00:00",
  live_status: "none",
  status: "inbox",
  is_short: 0,
  is_private: 0,
  watched: null,
  ...patch,
});

const settings = {
  shared_tag_points: 25,
  tag_history_points: 3,
  tag_history_cap: 36,
  watched_channel_points: 8,
  watched_channel_cap: 40,
  playlist_points: 20,
  liked_points: 35,
  already_watched_points: 10,
  started_points: 15,
  external_adjustment: -5,
  recency_points: 18,
};

describe("recommendation eligibility", () => {
  test("requires confirmed regular, non-live, playable and unfinished videos", () => {
    expect(isEligibleRecommendation(candidate())).toBe(true);
    expect(isEligibleRecommendation(candidate({ is_short: null }))).toBe(false);
    expect(isEligibleRecommendation(candidate({ is_short: 1 }))).toBe(false);
    expect(isEligibleRecommendation(candidate({ live_status: null }))).toBe(false);
    expect(isEligibleRecommendation(candidate({ live_status: "upcoming" }))).toBe(false);
    expect(isEligibleRecommendation(candidate({ live_status: "live" }))).toBe(false);
    expect(isEligibleRecommendation(candidate({ live_status: "was_live" }))).toBe(false);
    expect(isEligibleRecommendation(candidate({ is_private: 1 }))).toBe(false);
    expect(isEligibleRecommendation(candidate({ watched: 1 }))).toBe(false);
    expect(isEligibleRecommendation(candidate({ status: "archived" }))).toBe(false);
    expect(isEligibleRecommendation(candidate({ watch_position: 500, watch_duration: 1000 }))).toBe(true);
    expect(isEligibleRecommendation(candidate({ watch_position: 920, watch_duration: 1000 }))).toBe(false);
  });

  test("uses the same meaningful-progress thresholds as the in-progress shelf", () => {
    expect(recommendationProgress(candidate({ watch_position: 3, watch_duration: 31 }))).toBeCloseTo(3 / 31, 8);
    expect(recommendationProgress(candidate({ watch_position: 2.9, watch_duration: 100 }))).toBeNull();
    expect(recommendationProgress(candidate({ watch_position: 3, watch_duration: 30 }))).toBeNull();
  });
});

describe("recommendation viewing time", () => {
  test("wraps the nearby-hour window across midnight", () => {
    expect(recommendationHoursNear(0)).toEqual([23, 0, 1]);
    expect(recommendationHoursNear(23)).toEqual([22, 23, 0]);
  });

  test("uses stable local-time periods", () => {
    expect(recommendationTimeOfDay(4)).toBe("night");
    expect(recommendationTimeOfDay(5)).toBe("morning");
    expect(recommendationTimeOfDay(12)).toBe("afternoon");
    expect(recommendationTimeOfDay(17)).toBe("evening");
  });
});

describe("recommendation scoring", () => {
  test("orders current-hour Pulse as tags, then channels, then general signals", () => {
    const now = Date.parse("2026-07-29T12:00:00Z");
    const pulseTag = scoreRecommendationCandidate(candidate({ tag_time_seconds: 60 }), settings, now)!;
    const pulseChannel = scoreRecommendationCandidate(candidate({ channel_time_seconds: 10 ** 9 }), settings, now)!;
    const generalTag = scoreRecommendationCandidate(candidate({ tag_hits: 1 }), settings, now)!;
    const strongestGeneralChannel = scoreRecommendationCandidate(candidate({ channel_watch_count: 1000 }), settings, now)!;
    const liked = scoreRecommendationCandidate(candidate({ liked: 1 }), settings, now)!;

    expect(pulseTag.score).toBeGreaterThan(pulseChannel.score);
    expect(pulseChannel.score).toBeGreaterThan(generalTag.score);
    expect(generalTag.score).toBeGreaterThan(strongestGeneralChannel.score);
    expect(strongestGeneralChannel.score).toBeGreaterThan(liked.score);
  });

  test("uses bounded Pulse tiers without persistent settings", () => {
    const now = Date.parse("2026-07-29T12:00:00Z");
    const withoutTime = scoreRecommendationCandidate(candidate(), settings, now)!;
    const matchingTime = scoreRecommendationCandidate(candidate({ tag_time_seconds: 900 }), settings, now)!;
    const hugeTime = scoreRecommendationCandidate(candidate({ tag_time_seconds: 10 ** 12 }), settings, now)!;

    expect(matchingTime.score).toBeGreaterThan(withoutTime.score);
    expect(matchingTime.reasons).toContain("time of day");
    expect(hugeTime.score - withoutTime.score).toBeCloseTo(10_500, 8);
  });

  test("boosts meaningful continuations but rejects effectively completed progress", () => {
    const now = Date.parse("2026-07-29T12:00:00Z");
    const fresh = scoreRecommendationCandidate(candidate(), settings, now)!;
    const partial = scoreRecommendationCandidate(candidate({ watch_position: 500, watch_duration: 1000 }), settings, now)!;
    expect(partial.score).toBeGreaterThan(fresh.score);
    expect(partial.reasons).toContain("started watching");
    expect(scoreRecommendationCandidate(candidate({ watch_position: 950, watch_duration: 1000 }), settings, now)).toBeNull();
  });

  test("treats a previous open as a weak signal, not as completion", () => {
    const now = Date.parse("2026-07-29T12:00:00Z");
    const fresh = scoreRecommendationCandidate(candidate(), settings, now)!;
    const opened = scoreRecommendationCandidate(candidate({ in_history: 1 }), settings, now)!;
    expect(opened.score).toBeGreaterThan(fresh.score);
    expect(opened.reasons).toContain("opened before");
  });
});

describe("recommendation diversification", () => {
  test("is deterministic and prevents one channel from taking the top of the list", () => {
    const ranked = [
      { kind: "local", score: 100, reasons: [], video: candidate({ video_id: "a-1", channel_id: "a" }) },
      { kind: "local", score: 99, reasons: [], video: candidate({ video_id: "a-2", channel_id: "a" }) },
      { kind: "local", score: 95, reasons: [], video: candidate({ video_id: "b-1", channel_id: "b" }) },
    ] satisfies RankedRecommendation[];

    const first = diversifyRecommendations(ranked, 3, 2).map((item) => item.video?.video_id);
    const second = diversifyRecommendations(ranked, 3, 2).map((item) => item.video?.video_id);
    expect(first).toEqual(["a-1", "b-1", "a-2"]);
    expect(second).toEqual(first);
  });
});
