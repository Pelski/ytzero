import { db } from "./db";

function count(sql: string): number {
  return Number((db.prepare(sql).get() as { count: number } | null)?.count ?? 0);
}

function groupedCounts(sql: string): Record<string, number> {
  const rows = db.prepare(sql).all() as { name: string; count: number }[];
  return Object.fromEntries(rows.map((row) => [row.name, Number(row.count)]));
}

/**
 * A privacy-safe operational snapshot. It deliberately contains only aggregate
 * counts and configuration state: no titles, URLs, filesystem paths, profile
 * names, cookies, tokens, or backup contents.
 */
export function collectDiagnosticSnapshot() {
  const sqlite = db.prepare("PRAGMA journal_mode").get() as { journal_mode: string } | null;
  const integrity = db.prepare("PRAGMA quick_check").get() as { quick_check: string } | null;
  return {
    database: {
      journalMode: sqlite?.journal_mode ?? "unknown",
      quickCheck: integrity?.quick_check ?? "unknown",
    },
    profiles: count("SELECT COUNT(*) AS count FROM users"),
    channels: {
      total: count("SELECT COUNT(*) AS count FROM channels"),
      followed: count("SELECT COUNT(DISTINCT channel_id) AS count FROM user_channels WHERE followed = 1"),
      external: count("SELECT COUNT(*) AS count FROM channels WHERE external = 1"),
      manualStatuses: groupedCounts("SELECT manual_status AS name, COUNT(*) AS count FROM channels GROUP BY manual_status"),
    },
    videos: {
      total: count("SELECT COUNT(*) AS count FROM videos"),
      private: count("SELECT COUNT(*) AS count FROM videos WHERE is_private = 1"),
      liveStatuses: groupedCounts("SELECT live_status AS name, COUNT(*) AS count FROM videos GROUP BY live_status"),
    },
    downloads: groupedCounts("SELECT status AS name, COUNT(*) AS count FROM downloads GROUP BY status"),
    plugins: {
      enabled: count("SELECT COUNT(*) AS count FROM plugins WHERE enabled = 1"),
      total: count("SELECT COUNT(*) AS count FROM plugins"),
    },
  };
}
