import { describe, expect, test } from "bun:test";
import { cleanupSelectionWhere, type CleanupFilter } from "./cleanupQuery";

describe("cleanup selection WHERE builder", () => {
  test("empty filter matches everything, no params", () => {
    const { where, params } = cleanupSelectionWhere({}, 7);
    expect(where).toEqual([]);
    expect(params).toEqual([]);
  });

  test("before adds a strict published_at comparison", () => {
    const { where, params } = cleanupSelectionWhere({ before: "2026-01-01T00:00:00.000Z" }, 7);
    expect(where).toEqual(["v.published_at < ?"]);
    expect(params).toEqual(["2026-01-01T00:00:00.000Z"]);
  });

  test("channels include filters to the given IN list", () => {
    const filter: CleanupFilter = { channels: { mode: "include", ids: ["chA", "chB"] } };
    const { where, params } = cleanupSelectionWhere(filter, 7);
    expect(where).toEqual(["v.channel_id IN (?,?)"]);
    expect(params).toEqual(["chA", "chB"]);
  });

  test("channels exclude negates with NOT IN", () => {
    const filter: CleanupFilter = { channels: { mode: "exclude", ids: ["chA"] } };
    const { where, params } = cleanupSelectionWhere(filter, 7);
    expect(where).toEqual(["v.channel_id NOT IN (?)"]);
    expect(params).toEqual(["chA"]);
  });

  test("empty channel id list contributes no clause regardless of mode", () => {
    const { where, params } = cleanupSelectionWhere({ channels: { mode: "include", ids: [] } }, 7);
    expect(where).toEqual([]);
    expect(params).toEqual([]);
  });

  test("tag include reuses tagFilterSql and scopes EXISTS checks to the user", () => {
    const filter: CleanupFilter = { tags: { include: [1, 2], exclude: [] } };
    const { where, params } = cleanupSelectionWhere(filter, 7);
    expect(where).toHaveLength(1);
    expect(where[0]).toContain("t.user_id = 7");
    expect(where[0]).not.toStartWith("NOT ");
    expect(params).toEqual([1, 2, 1, 2, 1, 2]);
  });

  test("tag exclude wraps the same fragment in NOT", () => {
    const filter: CleanupFilter = { tags: { include: [], exclude: [3] } };
    const { where, params } = cleanupSelectionWhere(filter, 7);
    expect(where).toHaveLength(1);
    expect(where[0].startsWith("NOT (")).toBe(true);
    expect(params).toEqual([3, 3, 3]);
  });

  test("include and exclude tags combine as two independent AND'ed clauses", () => {
    const filter: CleanupFilter = { tags: { include: [1], exclude: [2] } };
    const { where, params } = cleanupSelectionWhere(filter, 7);
    expect(where).toHaveLength(2);
    expect(where[0]).not.toStartWith("NOT ");
    expect(where[1].startsWith("NOT (")).toBe(true);
    expect(params).toEqual([1, 1, 1, 2, 2, 2]);
  });

  test("date, channels and tags combine as separate AND'ed clauses in params order", () => {
    const filter: CleanupFilter = {
      before: "2026-01-01T00:00:00.000Z",
      channels: { mode: "exclude", ids: ["chA"] },
      tags: { include: [5], exclude: [] },
    };
    const { where, params } = cleanupSelectionWhere(filter, 3);
    expect(where).toHaveLength(3);
    expect(params).toEqual(["2026-01-01T00:00:00.000Z", "chA", 5, 5, 5]);
  });
});
