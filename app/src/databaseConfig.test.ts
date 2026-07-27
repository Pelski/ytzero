import { describe, expect, test } from "bun:test";
import { assertPostgresUrl, databaseRuntimeConfig, redactDatabaseUrl } from "./databaseConfig";

describe("database runtime configuration", () => {
  test("keeps SQLite as the default", () => {
    const config = databaseRuntimeConfig({ DB_PATH: "/data/db/app.db" });
    expect(config.engine).toBe("sqlite");
    expect(config.sqlitePath).toBe("/data/db/app.db");
    expect(config.statePath).toBe("/data/database-state.json");
  });

  test("detects PostgreSQL and never displays its credentials", () => {
    const config = databaseRuntimeConfig({
      DB_PATH: "/data/db/app.db",
      DATABASE_URL: "postgresql://alice:secret@db.internal:5432/ytzero?sslmode=require",
    });
    expect(config.engine).toBe("postgres");
    expect(config.displayLocation).not.toContain("secret");
    expect(config.displayLocation).toContain("db.internal");
    expect(config.locatorFingerprint).toHaveLength(64);
  });

  test("redacts secret query parameters and validates targets", () => {
    expect(redactDatabaseUrl("postgres://host/db?sslkey=private")).not.toContain("private");
    expect(() => assertPostgresUrl("sqlite://app.db")).toThrow("postgresql://");
    expect(() => assertPostgresUrl("postgres://host/db")).not.toThrow();
  });
});
