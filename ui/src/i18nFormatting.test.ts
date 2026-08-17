import { describe, expect, test } from "bun:test";
import { formatPublishedAgo, formatTimeAgo } from "./i18n";

describe("relative time formatting", () => {
  test("omits malformed timestamps instead of throwing during card rendering", () => {
    expect(formatTimeAgo("not-a-timestamp", "en")).toBe("");
    expect(formatTimeAgo(" ", "pl")).toBe("");
  });

  test("omits non-finite pre-parsed relative values", () => {
    expect(formatPublishedAgo({ value: Number.NaN, unit: "day" }, "en")).toBe("");
    expect(formatPublishedAgo({ value: Number.POSITIVE_INFINITY, unit: "year" }, "de")).toBe("");
  });
});
