import { describe, expect, test } from "bun:test";
import { resolveSidebarHidden } from "./sidebarVisibility";

describe("sidebar visibility", () => {
  test("keeps the mobile drawer closed regardless of the desktop preference", () => {
    expect(resolveSidebarHidden(true, null)).toBe(true);
    expect(resolveSidebarHidden(true, "1")).toBe(true);
    expect(resolveSidebarHidden(true, "0")).toBe(true);
  });

  test("restores the saved desktop preference", () => {
    expect(resolveSidebarHidden(false, null)).toBe(false);
    expect(resolveSidebarHidden(false, "1")).toBe(false);
    expect(resolveSidebarHidden(false, "0")).toBe(true);
  });
});
