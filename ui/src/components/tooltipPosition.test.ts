import { describe, expect, test } from "bun:test";
import { getTooltipPosition } from "./tooltipPosition";

const anchor = { left: 140, right: 180, top: 90, bottom: 110, width: 40, height: 20 };

describe("portal tooltip positioning", () => {
  test("preserves the requested placement when it fits", () => {
    expect(getTooltipPosition({
      anchor,
      tooltipWidth: 100,
      tooltipHeight: 30,
      side: "left",
      viewportWidth: 400,
      viewportHeight: 240,
    })).toEqual({ left: 33, top: 85 });
  });

  test("shifts tooltips inside every viewport edge", () => {
    const edgeAnchor = { left: 2, right: 22, top: 2, bottom: 22, width: 20, height: 20 };
    expect(getTooltipPosition({ anchor: edgeAnchor, tooltipWidth: 120, tooltipHeight: 40, side: "left", viewportWidth: 300, viewportHeight: 200 })).toEqual({ left: 8, top: 8 });

    const oppositeEdgeAnchor = { left: 278, right: 298, top: 178, bottom: 198, width: 20, height: 20 };
    expect(getTooltipPosition({ anchor: oppositeEdgeAnchor, tooltipWidth: 120, tooltipHeight: 40, side: "right", viewportWidth: 300, viewportHeight: 200 })).toEqual({ left: 172, top: 152 });
  });

  test("keeps the left edge visible when the tooltip is wider than the viewport", () => {
    expect(getTooltipPosition({
      anchor,
      tooltipWidth: 360,
      tooltipHeight: 30,
      side: "top",
      viewportWidth: 320,
      viewportHeight: 240,
    }).left).toBe(8);
  });
});
