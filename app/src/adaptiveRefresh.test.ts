import { describe, expect, test } from "bun:test";
import { estimateUploadCadenceMs, selectRefreshBatch, targetRefreshIntervalMs, type AdaptiveRefreshOptions, type RefreshCandidate } from "./adaptiveRefresh";

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const NOW = Date.parse("2026-07-26T12:00:00.000Z");
const options: AdaptiveRefreshOptions = {
  nowMs: NOW,
  batchSize: 10,
  fairnessSlots: 2,
  minIntervalMs: 10 * 60_000,
  maxIntervalMs: 12 * HOUR,
  unknownIntervalMs: 2 * HOUR,
};

function candidate(channelId: string, overrides: Partial<RefreshCandidate> = {}): RefreshCandidate {
  return {
    channelId,
    addedAt: "2026-01-01 00:00:00",
    lastRefreshedAt: "2026-07-26 10:00:00",
    lastAttemptedAt: "2026-07-26 10:00:00",
    consecutiveFailures: 0,
    publishedAt: [],
    ...overrides,
  };
}

function dailyDates(days: number[]) {
  return days.map((daysAgo) => new Date(NOW - daysAgo * DAY).toISOString());
}

describe("adaptive feed refresh", () => {
  test("uses the median upload gap instead of a burst or hiatus", () => {
    expect(estimateUploadCadenceMs(dailyDates([0, 1, 2, 3, 30, 31]))).toBe(DAY);
  });

  test("clamps cadence-derived intervals and uses a neutral unknown interval", () => {
    expect(targetRefreshIntervalMs(candidate("hourly", { publishedAt: dailyDates([0, 1 / 24, 2 / 24]) }), options)).toBe(options.minIntervalMs);
    expect(targetRefreshIntervalMs(candidate("daily", { publishedAt: dailyDates([0, 1, 2]) }), options)).toBe(HOUR);
    expect(targetRefreshIntervalMs(candidate("monthly", { publishedAt: dailyDates([0, 30, 60]) }), options)).toBe(options.maxIntervalMs);
    expect(targetRefreshIntervalMs(candidate("unknown"), options)).toBe(options.unknownIntervalMs);
  });

  test("prioritises a frequent uploader at the same time since refresh", () => {
    const frequent = candidate("frequent", { publishedAt: dailyDates([0, 1, 2]) });
    const infrequent = candidate("infrequent", { publishedAt: dailyDates([0, 7, 14]) });
    const result = selectRefreshBatch([infrequent, frequent], { ...options, batchSize: 1, fairnessSlots: 0 });
    expect(result.map((row) => row.channelId)).toEqual(["frequent"]);
  });

  test("reserves fairness slots for the oldest eligible channels", () => {
    const rows = Array.from({ length: 12 }, (_, index) => candidate(`frequent-${index}`, {
      lastAttemptedAt: "2026-07-26 10:00:00",
      publishedAt: dailyDates([0, 1, 2]),
    }));
    rows.push(candidate("stale-rare", {
      lastAttemptedAt: "2026-07-26 00:00:00",
      publishedAt: dailyDates([0, 30, 60]),
    }));
    const result = selectRefreshBatch(rows, options);
    expect(result).toHaveLength(10);
    expect(result.some((row) => row.channelId === "stale-rare" && row.reason === "fairness")).toBe(true);
  });

  test("does not select a channel again before its cooldown", () => {
    const recent = candidate("recent", {
      lastAttemptedAt: "2026-07-26 11:55:00",
      publishedAt: dailyDates([0, 1 / 24, 2 / 24]),
    });
    expect(selectRefreshBatch([recent], options)).toEqual([]);
  });

  test("backs off repeated failures", () => {
    const failed = candidate("failed", {
      lastAttemptedAt: "2026-07-26 11:00:00",
      publishedAt: dailyDates([0, 1 / 24, 2 / 24]),
      consecutiveFailures: 3,
    });
    expect(targetRefreshIntervalMs(failed, options)).toBe(80 * 60_000);
    expect(selectRefreshBatch([failed], options)).toEqual([]);
  });

  test("unattempted channels are immediately eligible and deterministic", () => {
    const result = selectRefreshBatch([
      candidate("b", { lastAttemptedAt: null, lastRefreshedAt: null }),
      candidate("a", { lastAttemptedAt: null, lastRefreshedAt: null }),
    ], { ...options, batchSize: 2 });
    expect(result.map((row) => row.channelId)).toEqual(["a", "b"]);
  });
});
