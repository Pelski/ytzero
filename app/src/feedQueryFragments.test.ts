import { describe, expect, test } from "bun:test";
import { feedSortSql } from "./feedQueryFragments";

describe("feed sorting", () => {
  test("defaults to YouTube publication order", () => {
    expect(feedSortSql()).toBe("v.published_at");
    expect(feedSortSql("published")).toBe("v.published_at");
  });

  test("supports first-seen arrival order", () => {
    expect(feedSortSql("arrival")).toBe("v.created_at");
  });
});
