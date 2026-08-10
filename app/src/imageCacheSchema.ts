import type { DatabaseEngine } from "./databaseConfig";

export function imageCacheTableSql(engine: DatabaseEngine): string {
  const integer = engine === "postgres" ? "BIGINT" : "INTEGER";
  return `
CREATE TABLE IF NOT EXISTS image_cache (
  url           TEXT PRIMARY KEY,
  path          TEXT NOT NULL,
  content_type  TEXT NOT NULL DEFAULT 'image/jpeg',
  fetched_at    ${integer} NOT NULL,
  last_try_at   ${integer} NOT NULL DEFAULT 0,
  last_error_at ${integer} NOT NULL DEFAULT 0
);
`;
}

export const POSTGRES_IMAGE_CACHE_TIMESTAMP_MIGRATION = `
ALTER TABLE image_cache ADD COLUMN IF NOT EXISTS last_error_at BIGINT NOT NULL DEFAULT 0;
ALTER TABLE image_cache
  ALTER COLUMN fetched_at TYPE BIGINT USING fetched_at::BIGINT,
  ALTER COLUMN last_try_at TYPE BIGINT USING last_try_at::BIGINT,
  ALTER COLUMN last_error_at TYPE BIGINT USING last_error_at::BIGINT;
`;
