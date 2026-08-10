import { database } from "./database";
import { feedVisibilityWhere } from "./feedQuery";
import { cleanupSelectionWhere, type CleanupFilter } from "./cleanupQuery";
import { configuredTimeZone, zonedDateTimeToUtc } from "./timeZone";

export type { CleanupChannelFilter, CleanupFilter, CleanupTagFilter } from "./cleanupQuery";
export { cleanupSelectionWhere } from "./cleanupQuery";

/**
 * Combines feed visibility (what the feed would ever show this profile) with the
 * cleanup selection (what the user chose to match) into one WHERE, so the preview
 * and the apply step can never see a different set of videos than each other or
 * than the feed. side "clean" = videos that will be affected; "remain" = the
 * feed as it would look afterwards (same visibility, selection negated).
 */
export function buildCleanupWhere(
  filter: CleanupFilter,
  uid: number,
  side: "clean" | "remain",
  excludeVideoIds: string[] = [],
): { where: string[]; params: any[] } {
  const visibility = feedVisibilityWhere(
    { status: filter.status ?? "inbox" },
    uid,
    { includeHidden: !!filter.include_hidden },
  );
  const normalizedFilter = filter.before && /^\d{4}-\d{2}-\d{2}$/.test(filter.before)
    ? { ...filter, before: zonedDateTimeToUtc(filter.before, 0, 0, 0, configuredTimeZone()).toISOString() }
    : filter;
  const selection = cleanupSelectionWhere(normalizedFilter, uid);
  const selectionSql = selection.where.length ? selection.where.join(" AND ") : "1=1";
  const where = [...visibility.where];
  const params = [...visibility.params];
  const excludeSql = excludeVideoIds.length ? `v.video_id NOT IN (${excludeVideoIds.map(() => "?").join(",")})` : null;

  if (side === "clean") {
    where.push(`(${selectionSql})`);
    params.push(...selection.params);
    if (excludeSql) {
      where.push(excludeSql);
      params.push(...excludeVideoIds);
    }
  } else {
    const clean = excludeSql ? `(${selectionSql}) AND ${excludeSql}` : `(${selectionSql})`;
    where.push(`NOT (${clean})`);
    params.push(...selection.params);
    if (excludeSql) params.push(...excludeVideoIds);
  }
  return { where, params };
}

function cleanupBaseQuery(uid: number, where: string[]): string {
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return `SELECT v.video_id FROM videos v LEFT JOIN user_videos uv ON uv.video_id = v.video_id AND uv.user_id = ${uid} ${whereSql}`;
}

export async function countCleanupMatches(filter: CleanupFilter, uid: number, side: "clean" | "remain", excludeVideoIds: string[] = []): Promise<number> {
  const { where, params } = buildCleanupWhere(filter, uid, side, excludeVideoIds);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const row = await database.prepare(
    `SELECT COUNT(*) AS n FROM videos v LEFT JOIN user_videos uv ON uv.video_id = v.video_id AND uv.user_id = ${uid} ${whereSql}`
  ).get(...params) as { n: number };
  return row.n;
}

export async function listCleanupVideoIds(filter: CleanupFilter, uid: number, excludeVideoIds: string[] = []): Promise<string[]> {
  const { where, params } = buildCleanupWhere(filter, uid, "clean", excludeVideoIds);
  const rows = await database.prepare(cleanupBaseQuery(uid, where)).all(...params) as { video_id: string }[];
  return rows.map((r) => r.video_id);
}

// ---------- apply + undo ----------

interface VideoStateSnapshot {
  video_id: string;
  existed: boolean;
  status: string | null;
  bucket: string | null;
  show_from: string | null;
  watched: number | null;
  playback_context_json: string | null;
}

const CLEANUP_SQL_BATCH_SIZE = 400;

function chunks<T>(items: T[], size = CLEANUP_SQL_BATCH_SIZE): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < items.length; offset += size) result.push(items.slice(offset, offset + size));
  return result;
}

export async function snapshotUserVideoState(uid: number, videoIds: string[]): Promise<VideoStateSnapshot[]> {
  if (videoIds.length === 0) return [];
  const rows = (await Promise.all(chunks(videoIds).map(async (batch) => {
    const ph = batch.map(() => "?").join(",");
    return await database.prepare(
      `SELECT video_id, status, bucket, show_from, watched, playback_context_json FROM user_videos WHERE user_id = ? AND video_id IN (${ph})`
    ).all(uid, ...batch) as { video_id: string; status: string; bucket: string | null; show_from: string | null; watched: number | null; playback_context_json: string | null }[];
  }))).flat();
  const existing = new Map(rows.map((r) => [r.video_id, r]));
  return videoIds.map((id) => {
    const row = existing.get(id);
    return row
      ? { video_id: id, existed: true, status: row.status, bucket: row.bucket, show_from: row.show_from, watched: row.watched, playback_context_json: row.playback_context_json }
      : { video_id: id, existed: false, status: null, bucket: null, show_from: null, watched: null, playback_context_json: null };
  });
}

// Cleanup's "watched" is bookkeeping, not a real watch — no history row, no
// discovery signal (see applyCleanupAction), unlike the single-card watched button.
export async function applyCleanupAction(uid: number, videoIds: string[], action: "archive" | "watched") {
  const run = database.transaction(async (ids: string[]) => {
    for (const batch of chunks(ids)) {
      const rowSql = action === "archive" ? "(?, ?, 'archived')" : "(?, ?, 'archived', 1)";
      const columns = action === "archive" ? "user_id, video_id, status" : "user_id, video_id, status, watched";
      const update = action === "archive"
        ? "status = 'archived', bucket = NULL, show_from = NULL, playback_context_json = NULL"
        : "status = 'archived', watched = 1, bucket = NULL, show_from = NULL, playback_context_json = NULL";
      const params = batch.flatMap((id) => [uid, id]);
      await database.prepare(
        `INSERT INTO user_videos (${columns}) VALUES ${batch.map(() => rowSql).join(",")}
         ON CONFLICT(user_id, video_id) DO UPDATE SET ${update}`
      ).run(...params);
    }
  });
  await run(videoIds);
}

const restoreExisting = database.prepare(
  `UPDATE user_videos SET status = ?, bucket = ?, show_from = ?, watched = ?, playback_context_json = ? WHERE user_id = ? AND video_id = ?`
);
const deleteRow = database.prepare(`DELETE FROM user_videos WHERE user_id = ? AND video_id = ?`);

export async function restoreUserVideoState(uid: number, snapshot: VideoStateSnapshot[]) {
  const run = database.transaction(async (items: VideoStateSnapshot[]) => {
    for (const item of items) {
      if (item.existed) await restoreExisting.run(item.status, item.bucket, item.show_from, item.watched, item.playback_context_json, uid, item.video_id);
      else await deleteRow.run(uid, item.video_id);
    }
  });
  await run(snapshot);
}

// One undo slot per profile — cleanup is an occasional, deliberate action, not
// something that needs a full history stack.
export async function saveBulkUndo(uid: number, action: string, snapshot: VideoStateSnapshot[]) {
  await database.prepare(
    `INSERT INTO bulk_undo (user_id, action, count, payload, created_at) VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET action = excluded.action, count = excluded.count, payload = excluded.payload, created_at = excluded.created_at`
  ).run(uid, action, snapshot.length, JSON.stringify(snapshot));
}

export async function loadBulkUndo(uid: number): Promise<{ action: string; count: number; snapshot: VideoStateSnapshot[] } | null> {
  const row = await database.prepare(`SELECT action, count, payload FROM bulk_undo WHERE user_id = ?`).get(uid) as { action: string; count: number; payload: string } | undefined;
  if (!row) return null;
  return { action: row.action, count: row.count, snapshot: JSON.parse(row.payload) };
}

export async function clearBulkUndo(uid: number) {
  await database.prepare(`DELETE FROM bulk_undo WHERE user_id = ?`).run(uid);
}
