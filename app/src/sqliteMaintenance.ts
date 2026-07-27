import type { Database } from "bun:sqlite";

export const DEFAULT_SQLITE_BUSY_TIMEOUT_MS = 5_000;
export const DEFAULT_SQLITE_OPTIMIZE_INTERVAL_HOURS = 24;

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

export function sqliteBusyTimeoutMs(): number {
  return boundedInteger(process.env.SQLITE_BUSY_TIMEOUT_MS, DEFAULT_SQLITE_BUSY_TIMEOUT_MS, 0, 60_000);
}

export function sqliteOptimizeIntervalMs(): number {
  const hours = boundedInteger(
    process.env.SQLITE_OPTIMIZE_INTERVAL_HOURS,
    DEFAULT_SQLITE_OPTIMIZE_INTERVAL_HOURS,
    1,
    168,
  );
  return hours * 60 * 60_000;
}

export function configureSQLiteConnection(database: Database): void {
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec(`PRAGMA busy_timeout = ${sqliteBusyTimeoutMs()};`);
}

/**
 * SQLite recommends the 0x10000 flag for a newly opened, long-lived connection.
 * The 0x00002 flag allows it to run bounded ANALYZE work where useful.
 */
export function optimizeSQLite(database: Database, freshConnection = false): void {
  database.exec(freshConnection ? "PRAGMA optimize=0x10002;" : "PRAGMA optimize;");
}

export function startSQLiteMaintenance(database: Database): () => void {
  const timer = setInterval(() => optimizeSQLite(database), sqliteOptimizeIntervalMs());
  timer.unref?.();
  return () => clearInterval(timer);
}
