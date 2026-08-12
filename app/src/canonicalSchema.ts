import type { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";

const SCHEMA_SOURCE_PREFIX = "app/src/";

export const CANONICAL_SCHEMA_FILES = [
  "app/src/schema.sql",
  "app/src/channelPostsSchema.sql",
  "app/src/tubeArchivistSchema.sql",
] as const;

export type CanonicalSchemaFile = (typeof CANONICAL_SCHEMA_FILES)[number];

export function applyCanonicalSQLiteSchema(database: Database): void {
  for (const path of CANONICAL_SCHEMA_FILES) {
    const file = path.slice(SCHEMA_SOURCE_PREFIX.length);
    database.exec(readFileSync(new URL(file, import.meta.url), "utf8"));
  }
}
