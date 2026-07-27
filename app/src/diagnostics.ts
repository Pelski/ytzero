import { database, databaseConfig } from "./database";

async function count(sql: string): Promise<number> {
  return Number((await database.prepare(sql).get<{ count: number }>())?.count ?? 0);
}

async function groupedCounts(sql: string): Promise<Record<string, number>> {
  const rows = await database.prepare(sql).all<{ name: string; count: number }>();
  return Object.fromEntries(rows.map((row) => [row.name, Number(row.count)]));
}

async function databaseDiagnostics() {
  const schemaVersion = Number((await database.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get<{ version: number }>())?.version ?? 0);
  if (databaseConfig.engine === "postgres") {
    const version = await database.prepare("SHOW server_version").get<Record<string, string>>();
    const size = await database.prepare("SELECT pg_database_size(current_database()) AS bytes").get<{ bytes: number }>();
    return {
      engine: "postgres",
      version: version?.server_version ?? Object.values(version ?? {})[0] ?? "unknown",
      schemaVersion,
      location: databaseConfig.displayLocation,
      sizeBytes: Number(size?.bytes ?? 0),
    };
  }

  const journal = await database.prepare("PRAGMA journal_mode").get<{ journal_mode: string }>();
  const integrity = await database.prepare("PRAGMA quick_check").get<{ quick_check: string }>();
  const version = await database.prepare("SELECT sqlite_version() AS version").get<{ version: string }>();
  const pageSize = await database.prepare("PRAGMA page_size").get<{ page_size: number }>();
  const pageCount = await database.prepare("PRAGMA page_count").get<{ page_count: number }>();
  const freePages = await database.prepare("PRAGMA freelist_count").get<{ freelist_count: number }>();
  const busyTimeout = await database.prepare("PRAGMA busy_timeout").get<{ timeout: number }>();
  const checkpoint = await database.prepare("PRAGMA wal_checkpoint(NOOP)").get<{ busy: number; log: number; checkpointed: number }>();
  const statistics = await database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='sqlite_stat1'").get<{ count: number }>();
  return {
    engine: "sqlite",
    version: version?.version ?? "unknown",
    schemaVersion,
    location: databaseConfig.displayLocation,
    journalMode: journal?.journal_mode ?? "unknown",
    quickCheck: integrity?.quick_check ?? "unknown",
    busyTimeoutMs: Number(busyTimeout?.timeout ?? 0),
    pageSizeBytes: Number(pageSize?.page_size ?? 0),
    pageCount: Number(pageCount?.page_count ?? 0),
    freePages: Number(freePages?.freelist_count ?? 0),
    wal: {
      busy: Number(checkpoint?.busy ?? 0),
      frames: Number(checkpoint?.log ?? 0),
      checkpointedFrames: Number(checkpoint?.checkpointed ?? 0),
    },
    plannerStatistics: Number(statistics?.count ?? 0) > 0,
  };
}

/** Privacy-safe operational snapshot: aggregate counts and redacted config only. */
export async function collectDiagnosticSnapshot() {
  return {
    database: await databaseDiagnostics(),
    profiles: await count("SELECT COUNT(*) AS count FROM users"),
    channels: {
      total: await count("SELECT COUNT(*) AS count FROM channels"),
      followed: await count("SELECT COUNT(DISTINCT channel_id) AS count FROM user_channels WHERE followed = 1"),
      external: await count("SELECT COUNT(*) AS count FROM channels WHERE external = 1"),
      manualStatuses: await groupedCounts("SELECT manual_status AS name, COUNT(*) AS count FROM channels GROUP BY manual_status"),
    },
    videos: {
      total: await count("SELECT COUNT(*) AS count FROM videos"),
      private: await count("SELECT COUNT(*) AS count FROM videos WHERE is_private = 1"),
      liveStatuses: await groupedCounts("SELECT live_status AS name, COUNT(*) AS count FROM videos GROUP BY live_status"),
    },
    downloads: await groupedCounts("SELECT status AS name, COUNT(*) AS count FROM downloads GROUP BY status"),
    plugins: {
      enabled: await count("SELECT COUNT(*) AS count FROM plugins WHERE enabled = 1"),
      total: await count("SELECT COUNT(*) AS count FROM plugins"),
    },
  };
}
