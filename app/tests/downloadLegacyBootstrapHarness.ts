import { Database } from "bun:sqlite";

const path = Bun.env.DB_PATH;
if (!path) throw new Error("DB_PATH is required");

// Reproduce the downloads rule table from immediately before rules became
// profile-owned. db.ts must be able to upgrade it before creating user indexes.
const legacy = new Database(path, { create: true });
legacy.exec(`
  CREATE TABLE download_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    portable_uuid TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    source_mode TEXT NOT NULL DEFAULT 'selected',
    channel_ids_json TEXT NOT NULL DEFAULT '[]',
    playlist_ids_json TEXT NOT NULL DEFAULT '[]',
    include_keywords_json TEXT NOT NULL DEFAULT '[]',
    exclude_keywords_json TEXT NOT NULL DEFAULT '[]',
    keyword_mode TEXT NOT NULL DEFAULT 'any',
    match_field TEXT NOT NULL DEFAULT 'title',
    include_shorts INTEGER NOT NULL DEFAULT 0,
    include_members_only INTEGER NOT NULL DEFAULT 0,
    min_duration_seconds INTEGER NOT NULL DEFAULT 0,
    backfill_mode TEXT NOT NULL DEFAULT 'future',
    lookback_hours INTEGER NOT NULL DEFAULT 48,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
legacy.close();

const { db } = await import("../src/db");
const columns = db.prepare("PRAGMA table_info(download_rules)").all() as { name: string }[];
const indexes = db.prepare("PRAGMA index_list(download_rules)").all() as { name: string }[];
console.log("RESULT " + JSON.stringify({
  hasUserId: columns.some((column) => column.name === "user_id"),
  hasProfileIndex: indexes.some((index) => index.name === "idx_download_rules_user_enabled"),
}));
db.close();
