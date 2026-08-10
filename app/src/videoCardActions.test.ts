import { describe, expect, test } from "bun:test";
import { isVideoCardActionMode, normalizeVideoCardActionConfig, normalizeVideoCardActionMode, normalizeVideoCardSwipeConfig, parseVideoCardActionConfig, parseVideoCardSwipeConfig, VIDEO_CARD_ACTION_MODES } from "./videoCardActions";

describe("video card action modes", () => {
  test("accepts every persisted mode", () => {
    expect(VIDEO_CARD_ACTION_MODES.every(isVideoCardActionMode)).toBe(true);
    expect(isVideoCardActionMode("bar_always")).toBe(true);
  });

  test("normalizes unsupported backup values to hover", () => {
    expect(normalizeVideoCardActionMode("surprise")).toBe("hover");
  });
});

describe("video card action configuration", () => {
  test("keeps schedule first and appends actions introduced after an older config", () => {
    expect(parseVideoCardActionConfig({ version: 1, actions: [{ id: "playlist", hidden: true }] })?.actions).toEqual([
      { id: "schedule", hidden: false },
      { id: "playlist", hidden: true },
      { id: "download", hidden: true },
      { id: "archive", hidden: false },
      { id: "watched", hidden: false },
      { id: "restore", hidden: false },
      { id: "remove", hidden: false },
    ]);
  });

  test("rejects duplicate or unknown action identifiers", () => {
    expect(parseVideoCardActionConfig({ version: 1, actions: [{ id: "playlist", hidden: false }, { id: "playlist", hidden: true }] })).toBeNull();
    expect(parseVideoCardActionConfig({ version: 1, actions: [{ id: "surprise", hidden: false }] })).toBeNull();
  });

  test("normalizes malformed backup values to the default", () => {
    const actions = JSON.parse(normalizeVideoCardActionConfig("bad json")).actions;
    expect(actions).toHaveLength(7);
    expect(actions.filter((action: { hidden: boolean }) => action.hidden).map((action: { id: string }) => action.id)).toEqual(["playlist", "download"]);
  });

  test("keeps required actions visible", () => {
    const config = parseVideoCardActionConfig({ version: 1, actions: [{ id: "restore", hidden: true }, { id: "remove", hidden: true }, { id: "schedule", hidden: true }] });
    expect(config?.actions.slice(0, 3)).toEqual([{ id: "schedule", hidden: false }, { id: "restore", hidden: false }, { id: "remove", hidden: false }]);
  });
});

describe("video card swipe devices", () => {
  test("defaults to every device and preserves canonical order", () => {
    expect(JSON.parse(normalizeVideoCardSwipeConfig(null)).devices).toEqual(["desktop", "tablet", "mobile"]);
    expect(parseVideoCardSwipeConfig({ version: 1, devices: ["mobile", "desktop"] })?.devices).toEqual(["desktop", "mobile"]);
  });

  test("accepts disabling swipe everywhere but rejects malformed device lists", () => {
    expect(parseVideoCardSwipeConfig({ version: 1, devices: [] })).toEqual({ version: 1, devices: [] });
    expect(parseVideoCardSwipeConfig({ version: 1, devices: ["phone"] })).toBeNull();
    expect(parseVideoCardSwipeConfig({ version: 1, devices: ["mobile", "mobile"] })).toBeNull();
  });
});
