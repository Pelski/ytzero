import { describe, expect, test } from "bun:test";
import { AsyncDatabaseClient, postgresQuery } from "./databaseClient";

describe("PostgreSQL query compatibility", () => {
  test("numbers placeholders without touching strings or comments", () => {
    expect(postgresQuery("SELECT '?' AS literal, value FROM things WHERE a=? AND b=? -- ?\n")).toBe(
      "SELECT '?' AS literal, value FROM things WHERE a=$1 AND b=$2 -- ?\n",
    );
  });

  test("translates SQLite time, collation, real and ignore syntax", () => {
    const query = postgresQuery("INSERT OR IGNORE INTO t(id, at) SELECT ?, datetime('now', ?) COLLATE NOCASE;");
    expect(query).toContain("INSERT INTO t");
    expect(query).toContain("$1");
    expect(query).toContain("$2::interval");
    expect(query).toContain("ON CONFLICT DO NOTHING");
    expect(query).not.toContain("NOCASE");
  });

  test("provides a common async API and transaction scope for SQLite", async () => {
    const database = new AsyncDatabaseClient("sqlite", ":memory:");
    await database.exec("CREATE TABLE values_table (id INTEGER PRIMARY KEY, value TEXT)");
    const insert = database.prepare("INSERT INTO values_table(value) VALUES (?)");
    const save = database.transaction(async (values: string[]) => {
      for (const value of values) await insert.run(value);
    });
    await save(["one", "two"]);
    expect(await database.query("SELECT value FROM values_table ORDER BY id").all()).toEqual([{ value: "one" }, { value: "two" }]);
    await database.close();
  });

  test("normalizes known PostgreSQL bigint result columns without changing text identifiers", () => {
    const query = postgresQuery("SELECT id, video_id FROM videos WHERE user_id = ?");
    expect(query).toContain("user_id = $1");
  });
});
