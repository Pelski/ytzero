import { describe, expect, test } from "bun:test";
import { imageCacheTableSql, POSTGRES_IMAGE_CACHE_TIMESTAMP_MIGRATION } from "./imageCacheSchema";

describe("image cache schema", () => {
  test("uses 64-bit millisecond timestamps on PostgreSQL", () => {
    const schema = imageCacheTableSql("postgres");
    expect(schema.match(/BIGINT/g)).toHaveLength(3);
    expect(schema).not.toMatch(/\bINTEGER\b/);
  });

  test("keeps SQLite's native 64-bit INTEGER storage", () => {
    const schema = imageCacheTableSql("sqlite");
    expect(schema.match(/INTEGER/g)).toHaveLength(3);
    expect(schema).not.toContain("BIGINT");
  });

  test("widens every timestamp column created by older PostgreSQL releases", () => {
    for (const column of ["fetched_at", "last_try_at", "last_error_at"]) {
      expect(POSTGRES_IMAGE_CACHE_TIMESTAMP_MIGRATION).toContain(`ALTER COLUMN ${column} TYPE BIGINT`);
    }
  });
});
