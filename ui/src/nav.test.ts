import { describe, expect, test } from "bun:test";
import { NAV_ITEMS, parseNavConfig, splitNavItems } from "./nav";

describe("recommendations navigation", () => {
  test("uses the first-class recommendations route", () => {
    expect(NAV_ITEMS.some((item) => item.to === "/recommendations")).toBe(true);
    expect(NAV_ITEMS.some((item) => item.to === "/discovery")).toBe(false);
  });

  test("hides recommendations by default while keeping it available in display settings", () => {
    const parsed = parseNavConfig(null);

    expect(JSON.stringify(parsed.find((entry) => entry.key === "/recommendations"))).toBe(JSON.stringify({
      key: "/recommendations",
      hidden: true,
    }));
    expect(splitNavItems(parsed).hidden.some((item) => item.to === "/recommendations")).toBe(true);
  });

  test("preserves an explicitly enabled recommendations entry", () => {
    const parsed = parseNavConfig(JSON.stringify([
      { key: "/recommendations", hidden: false },
    ]));

    expect(splitNavItems(parsed).visible.some((item) => item.to === "/recommendations")).toBe(true);
  });

  test("migrates the legacy discovery entry without losing its position or visibility", () => {
    const parsed = parseNavConfig(JSON.stringify([
      { key: "/", hidden: false },
      { key: "/discovery", hidden: true },
      { key: "/history", hidden: false },
    ]));

    expect(JSON.stringify(parsed.slice(0, 3))).toBe(JSON.stringify([
      { key: "/", hidden: false },
      { key: "/recommendations", hidden: true },
      { key: "/history", hidden: false },
    ]));
    expect(parsed.filter((entry) => entry.key === "/recommendations").length).toBe(1);
    expect(splitNavItems(parsed).hidden.some((item) => item.to === "/recommendations")).toBe(true);
  });

  test("deduplicates a config containing both legacy and current routes", () => {
    const parsed = parseNavConfig(JSON.stringify([
      { key: "/discovery", hidden: false },
      { key: "/recommendations", hidden: true },
    ]));

    expect(JSON.stringify(parsed.filter((entry) => entry.key === "/recommendations"))).toBe(JSON.stringify([
      { key: "/recommendations", hidden: false },
    ]));
  });
});
