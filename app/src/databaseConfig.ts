import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";

export type DatabaseEngine = "sqlite" | "postgres";

export interface DatabaseRuntimeConfig {
  engine: DatabaseEngine;
  url: string;
  sqlitePath: string;
  statePath: string;
  displayLocation: string;
  locatorFingerprint: string;
}

function postgresUrl(value: string): boolean {
  return /^postgres(?:ql)?:\/\//i.test(value);
}

export function redactDatabaseUrl(value: string): string {
  if (!postgresUrl(value)) return value;
  const parsed = new URL(value);
  parsed.username = parsed.username ? "***" : "";
  parsed.password = parsed.password ? "***" : "";
  for (const key of ["password", "sslpassword", "sslkey", "sslcert"]) {
    if (parsed.searchParams.has(key)) parsed.searchParams.set(key, "***");
  }
  return parsed.toString();
}

export function databaseLocatorFingerprint(engine: DatabaseEngine, location: string): string {
  const safeLocation = engine === "postgres" ? redactDatabaseUrl(location) : resolve(location);
  return createHash("sha256").update(`${engine}:${safeLocation}`).digest("hex");
}

export function databaseRuntimeConfig(env: NodeJS.ProcessEnv = process.env): DatabaseRuntimeConfig {
  const sqlitePath = env.DB_PATH ?? resolve(import.meta.dir, "../../data/db/ytzero.db");
  const configured = env.DATABASE_URL?.trim();
  const engine: DatabaseEngine = configured && postgresUrl(configured) ? "postgres" : "sqlite";
  const url = engine === "postgres" ? configured! : configured || `sqlite://${sqlitePath}`;
  const displayLocation = engine === "postgres" ? redactDatabaseUrl(url) : sqlitePath;
  return {
    engine,
    url,
    sqlitePath,
    statePath: env.DATABASE_STATE_PATH ?? resolve(dirname(sqlitePath), "../database-state.json"),
    displayLocation,
    locatorFingerprint: databaseLocatorFingerprint(engine, engine === "postgres" ? url : sqlitePath),
  };
}

export function assertPostgresUrl(value: string): void {
  if (!postgresUrl(value)) throw new Error("a postgresql:// or postgres:// target URL is required");
}
