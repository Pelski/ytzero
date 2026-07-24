import { db } from "./db";
import { feedVisibilityWhere } from "./feedQuery";
import { cleanupSelectionWhere, type CleanupFilter } from "./cleanupQuery";

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
  const selection = cleanupSelectionWhere(filter, uid);
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

export function countCleanupMatches(filter: CleanupFilter, uid: number, side: "clean" | "remain", excludeVideoIds: string[] = []): number {
  const { where, params } = buildCleanupWhere(filter, uid, side, excludeVideoIds);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const row = db.prepare(
    `SELECT COUNT(*) AS n FROM videos v LEFT JOIN user_videos uv ON uv.video_id = v.video_id AND uv.user_id = ${uid} ${whereSql}`
  ).get(...params) as { n: number };
  return row.n;
}

export function listCleanupVideoIds(filter: CleanupFilter, uid: number, excludeVideoIds: string[] = []): string[] {
  const { where, params } = buildCleanupWhere(filter, uid, "clean", excludeVideoIds);
  const rows = db.prepare(cleanupBaseQuery(uid, where)).all(...params) as { video_id: string }[];
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
}

export function snapshotUserVideoState(uid: number, videoIds: string[]): VideoStateSnapshot[] {
  if (videoIds.length === 0) return [];
  const ph = videoIds.map(() => "?").join(",");
  const rows = db.prepare(
    `SELECT video_id, status, bucket, show_from, watched FROM user_videos WHERE user_id = ? AND video_id IN (${ph})`
  ).all(uid, ...videoIds) as { video_id: string; status: string; bucket: string | null; show_from: string | null; watched: number | null }[];
  const existing = new Map(rows.map((r) => [r.video_id, r]));
  return videoIds.map((id) => {
    const row = existing.get(id);
    return row
      ? { video_id: id, existed: true, status: row.status, bucket: row.bucket, show_from: row.show_from, watched: row.watched }
      : { video_id: id, existed: false, status: null, bucket: null, show_from: null, watched: null };
  });
}

const upsertArchived = db.prepare(
  `INSERT INTO user_videos (user_id, video_id, status) VALUES (?, ?, 'archived')
   ON CONFLICT(user_id, video_id) DO UPDATE SET status = 'archived', bucket = NULL, show_from = NULL`
);
// Cleanup's "watched" is bookkeeping, not a real watch — no history row, no
// discovery signal (see applyCleanupAction), unlike the single-card watched button.
const upsertWatchedArchived = db.prepare(
  `INSERT INTO user_videos (user_id, video_id, status, watched) VALUES (?, ?, 'archived', 1)
   ON CONFLICT(user_id, video_id) DO UPDATE SET status = 'archived', watched = 1, bucket = NULL, show_from = NULL`
);

export function applyCleanupAction(uid: number, videoIds: string[], action: "archive" | "watched") {
  const stmt = action === "archive" ? upsertArchived : upsertWatchedArchived;
  const run = db.transaction((ids: string[]) => {
    for (const id of ids) stmt.run(uid, id);
  });
  run(videoIds);
}

const restoreExisting = db.prepare(
  `UPDATE user_videos SET status = ?, bucket = ?, show_from = ?, watched = ? WHERE user_id = ? AND video_id = ?`
);
const deleteRow = db.prepare(`DELETE FROM user_videos WHERE user_id = ? AND video_id = ?`);

export function restoreUserVideoState(uid: number, snapshot: VideoStateSnapshot[]) {
  const run = db.transaction((items: VideoStateSnapshot[]) => {
    for (const item of items) {
      if (item.existed) restoreExisting.run(item.status, item.bucket, item.show_from, item.watched, uid, item.video_id);
      else deleteRow.run(uid, item.video_id);
    }
  });
  run(snapshot);
}

// One undo slot per profile — cleanup is an occasional, deliberate action, not
// something that needs a full history stack.
export function saveBulkUndo(uid: number, action: string, snapshot: VideoStateSnapshot[]) {
  db.prepare(
    `INSERT INTO bulk_undo (user_id, action, count, payload, created_at) VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET action = excluded.action, count = excluded.count, payload = excluded.payload, created_at = excluded.created_at`
  ).run(uid, action, snapshot.length, JSON.stringify(snapshot));
}

export function loadBulkUndo(uid: number): { action: string; count: number; snapshot: VideoStateSnapshot[] } | null {
  const row = db.prepare(`SELECT action, count, payload FROM bulk_undo WHERE user_id = ?`).get(uid) as { action: string; count: number; payload: string } | undefined;
  if (!row) return null;
  return { action: row.action, count: row.count, snapshot: JSON.parse(row.payload) };
}

export function clearBulkUndo(uid: number) {
  db.prepare(`DELETE FROM bulk_undo WHERE user_id = ?`).run(uid);
}
