import { describe, expect, test } from "bun:test";
import { channelSyncEnabled, isChannelManualStatus } from "./channelStatus";

describe("manual channel status", () => {
  test("accepts only supported statuses", () => {
    for (const status of ["active", "paused", "broken", "banned", "deleted"]) expect(isChannelManualStatus(status)).toBe(true);
    for (const status of ["unavailable", "", null, 1]) expect(isChannelManualStatus(status)).toBe(false);
  });

  test("only explicit non-active statuses stop sync", () => {
    expect(channelSyncEnabled("active")).toBe(true);
    expect(channelSyncEnabled(undefined)).toBe(true);
    for (const status of ["paused", "broken", "banned", "deleted"]) expect(channelSyncEnabled(status)).toBe(false);
  });
});
