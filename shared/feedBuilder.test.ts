import { describe, expect, test } from "bun:test";
import {
  defaultFeedBuilderConfig,
  feedRecipeWarnings,
  normalizeFeedBuilderConfig,
} from "./feedBuilder";

describe("feed builder configuration", () => {
  test("keeps the existing feed as the default", () => {
    const config = defaultFeedBuilderConfig();
    expect(config.mode).toBe("classic");
    expect(config.intervalRows).toBe(3);
    expect(config.sections.continueWatching).toEqual({ visible: true, afterStandardRows: 0 });
  });

  test("normalizes bounds, duplicate references, and recipe ids", () => {
    const config = normalizeFeedBuilderConfig({
      mode: "composed",
      intervalRows: 999,
      recipes: [
        { id: "same", name: "A", include: { channelIds: ["x", "x"] }, maxAgeDays: 999 },
        { id: "same", name: "B" },
      ],
    }, 7);
    expect(config.revision).toBe(7);
    expect(config.intervalRows).toBe(50);
    expect(config.recipes[0].include.channelIds).toEqual(["x"]);
    expect(config.recipes[0].maxAgeDays).toBe(183);
    expect(config.recipes[1].id === "same").toBe(false);
  });

  test("keeps maximum-length recipe ids unique", () => {
    const id = "x".repeat(100);
    const config = normalizeFeedBuilderConfig({ recipes: [{ id }, { id }, { id: `${id.slice(0, 98)}-2` }] });
    expect(config.recipes.map((recipe) => recipe.id)).toEqual([id, `${id.slice(0, 98)}-2`, `${id.slice(0, 98)}-3`]);
    expect(new Set(config.recipes.map((recipe) => recipe.id)).size).toBe(3);
  });

  test("warns when selected scope has no sources", () => {
    const recipe = normalizeFeedBuilderConfig({ recipes: [{}] }).recipes[0];
    expect(feedRecipeWarnings(recipe)).toEqual(["no-selected-sources"]);
  });
});
