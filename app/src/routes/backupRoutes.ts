import type { Context, Hono } from "hono";
import { database, databaseConfig } from "../database";
import { analyzePortableBackup, backupOptions, commitPortableRestore, createPortableBackup, deleteRestoreSession, planPortableRestore } from "../portableBackup";
import { acquireMaintenance } from "../maintenance";
import { migrateSQLiteToPostgres } from "../postgresMigration";
import { acceptCurrentDatabase, databaseRuntimeStatus, recordCompletedPostgresMigration } from "../databaseState";
import { log } from "../logger";
import { zonedDayHour } from "../timeZone";

type ApiEnvironment = { Variables: { userId: number; sessionAdmin?: boolean; profileAdmin?: boolean } };
type Api = Hono<ApiEnvironment>;
type ApiContext = Context<ApiEnvironment>;

export function registerBackupRoutes(
  api: Api,
  access: {
    isAdmin: (context: ApiContext) => boolean;
    currentUserId: (context: ApiContext) => number;
  },
): void {
  const { isAdmin, currentUserId } = access;

// ---------- portable backup and restore (admin only) ----------

api.get("/database/status", (c) => {
  if (!isAdmin(c)) return c.json({ error: "admin only" }, 403);
  return c.json(databaseRuntimeStatus());
});

api.post("/database/migration/sqlite-to-postgres", async (c) => {
  if (!isAdmin(c)) return c.json({ error: "admin only" }, 403);
  if (databaseConfig.engine !== "sqlite") return c.json({ error: "migration must be started while SQLite is active" }, 409);
  const { target_url } = await c.req.json().catch(() => ({}));
  if (typeof target_url !== "string" || !/^postgres(?:ql)?:\/\//i.test(target_url)) {
    return c.json({ error: "valid PostgreSQL URL required" }, 400);
  }
  const release = await acquireMaintenance("SQLite to PostgreSQL migration");
  try {
    const result = await migrateSQLiteToPostgres(databaseConfig.sqlitePath, target_url);
    recordCompletedPostgresMigration(target_url, result.receiptId);
    log.info("database.migrated", { source: "sqlite", target: "postgres", receiptId: result.receiptId, tables: result.tables, rows: result.rows });
    return c.json({ ...result, next: "Set DATABASE_URL to the PostgreSQL URL and restart the application." });
  } finally {
    release();
  }
});

api.post("/database/migration/confirm", async (c) => {
  if (!isAdmin(c)) return c.json({ error: "admin only" }, 403);
  const status = databaseRuntimeStatus();
  if (status.state !== "migration_ready" || databaseConfig.engine !== "postgres" || !status.pendingReceiptId) {
    return c.json({ error: "no verified migrated database is awaiting confirmation" }, 409);
  }
  const receipt = await database.prepare("SELECT id FROM database_migration_receipts WHERE id = ?").get(status.pendingReceiptId);
  if (!receipt) return c.json({ error: "migration receipt not found in the active database" }, 409);
  acceptCurrentDatabase();
  return c.json({ ok: true, status: databaseRuntimeStatus() });
});

api.get("/backup/options", async (c) => {
  if (!isAdmin(c)) return c.json({ error: "admin only" }, 403);
  c.header("Cache-Control", "private, no-store");
  return c.json(await backupOptions());
});

api.post("/backup/export", async (c) => {
  if (!isAdmin(c)) return c.json({ error: "admin only" }, 403);
  const startedAt = Date.now();
  const input = await c.req.json().catch(() => ({}));
  const archive = await createPortableBackup(input);
  log.info("backup.exported", {
    userId: currentUserId(c),
    preset: typeof input.preset === "string" ? input.preset : "default",
    profiles: Array.isArray(input.profiles) ? input.profiles.length : "all",
    selectedSections: Array.isArray(input.sections) ? input.sections.length : "preset",
    bytes: archive.length,
    ms: Date.now() - startedAt,
  });
  const date = zonedDayHour().day;
  const body = archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) as ArrayBuffer;
  return new Response(body, { headers: {
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="ytzero-backup-${date}.zip"`,
    "Cache-Control": "private, no-store",
    "Content-Length": String(archive.length),
  } });
});

api.post("/restore/analyze", async (c) => {
  if (!isAdmin(c)) return c.json({ error: "admin only" }, 403);
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) return c.json({ error: "backup file required" }, 400);
  if (!/\.(zip|ytzero-backup)$/i.test(file.name)) return c.json({ error: "choose a .zip or .ytzero-backup file" }, 400);
  const startedAt = Date.now();
  const result = await analyzePortableBackup(currentUserId(c), new Uint8Array(await file.arrayBuffer()));
  log.info("restore.analyzed", {
    userId: currentUserId(c),
    bytes: result.archiveBytes,
    profiles: result.manifest.profiles.length,
    sections: result.manifest.sections.length,
    warnings: result.warnings.length,
    sameSource: result.sameSource,
    ms: Date.now() - startedAt,
  });
  c.header("Cache-Control", "private, no-store");
  return c.json(result);
});

api.post("/restore/plan", async (c) => {
  if (!isAdmin(c)) return c.json({ error: "admin only" }, 403);
  const { sessionId, mappings, sections, strategy } = await c.req.json().catch(() => ({}));
  if (typeof sessionId !== "string" || !mappings || !Array.isArray(sections)) return c.json({ error: "invalid restore plan" }, 400);
  const result = await planPortableRestore(currentUserId(c), sessionId, { mappings, sections, strategy });
  log.info("restore.planned", { userId: currentUserId(c), ...result.changes, warnings: result.warnings.length });
  return c.json(result);
});

api.post("/restore/commit", async (c) => {
  if (!isAdmin(c)) return c.json({ error: "admin only" }, 403);
  const { sessionId, planRevision } = await c.req.json().catch(() => ({}));
  if (typeof sessionId !== "string" || !Number.isInteger(planRevision)) return c.json({ error: "invalid restore commit" }, 400);
  const startedAt = Date.now();
  const result = await commitPortableRestore(currentUserId(c), sessionId, planRevision);
  log.info("restore.committed", {
    userId: currentUserId(c),
    ...result.counts,
    warnings: result.counts.warnings.length,
    safetySnapshot: true,
    ms: Date.now() - startedAt,
  });
  return c.json(result);
});

api.delete("/restore/session/:id", (c) => {
  if (!isAdmin(c)) return c.json({ error: "admin only" }, 403);
  deleteRestoreSession(currentUserId(c), c.req.param("id"));
  log.info("restore.canceled", { userId: currentUserId(c) });
  return c.json({ ok: true });
});


}
