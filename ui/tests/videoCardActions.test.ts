import { describe, expect, test } from "bun:test";
import { parseVideoCardActionsMode } from "../src/videoCardActions";

describe("video card action modes", () => {
  test("accepts every supported mode", () => {
    expect(["hover", "always", "on_demand", "delay", "off"].map(parseVideoCardActionsMode))
      .toEqual(["hover", "always", "on_demand", "delay", "off"]);
  });

  test("falls back to hover for missing and unsupported values", () => {
    expect(parseVideoCardActionsMode(undefined)).toBe("hover");
    expect(parseVideoCardActionsMode("instant")).toBe("hover");
  });
});
