import { describe, expect, test } from "bun:test";
import { hasMembersOnlyBadge, parsePublishedTimeText, relativePublishedAt } from "./youtube";

describe("YouTube publication metadata", () => {
  test("parses relative publication labels returned by supported locales", () => {
    expect(parsePublishedTimeText("Streamed 3 weeks ago")).toEqual({ value: 3, unit: "week" });
    expect(parsePublishedTimeText("5 dni temu")).toEqual({ value: 5, unit: "day" });
    expect(parsePublishedTimeText("vor 2 Monaten")).toEqual({ value: 2, unit: "month" });
  });

  test("turns a relative label into an approximate historical date", () => {
    expect(relativePublishedAt({ value: 3, unit: "week" }, new Date("2026-07-22T12:00:00.000Z")))
      .toBe("2026-07-01T12:00:00.000Z");
    expect(relativePublishedAt({ value: 1, unit: "year" }, new Date("2026-07-22T12:00:00.000Z")))
      .toBe("2025-07-22T12:00:00.000Z");
  });

  test("recognizes current and legacy members-only badges", () => {
    expect(hasMembersOnlyBadge({ badgeViewModel: { badgeStyle: "BADGE_MEMBERS_ONLY" } })).toBe(true);
    expect(hasMembersOnlyBadge({ metadataBadgeRenderer: { style: "BADGE_STYLE_TYPE_MEMBERS_ONLY" } })).toBe(true);
    expect(hasMembersOnlyBadge({ thumbnailBadgeViewModel: { text: "21:00" } })).toBe(false);
  });
});
