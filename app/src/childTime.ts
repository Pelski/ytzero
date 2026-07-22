// Watch-time accounting for every profile (feeds the child limits today and
// the stats pages later) plus child-profile locks: daily time limits with
// parent-granted extensions, and a lockout after repeated wrong child-lock
// PINs. Enforcement is cooperative — the server stops counting and reports
// `locked`, and the UI locks the screen.
import { db, getUserSetting, setUserSetting } from "./db";
import { recordWatchTagSignals } from "./contentSignals";

export type ChildGrant = "15m" | "1h" | "video_end" | "today_off";
export const CHILD_GRANTS: ChildGrant[] = ["15m", "1h", "video_end", "today_off"];

const today = () => (db.prepare("SELECT date('now','localtime') AS d").get() as { d: string }).d;

export function isChildUser(userId: number): boolean {
  const row = db.prepare("SELECT is_child FROM users WHERE id = ?").get(userId) as { is_child: number } | null;
  return row?.is_child === 1;
}

/** Configured daily limit in seconds, or null when the profile has no limit. */
export function childLimitSeconds(userId: number): number | null {
  const min = parseInt(getUserSetting(userId, "child_limit_minutes") ?? "", 10);
  return Number.isFinite(min) && min > 0 ? min * 60 : null;
}

// ---------- watch-time log (all profiles) ----------

// Progress saves arrive ~1 s apart while a video actually plays, so wall-clock
// deltas between ticks are a good watch-time measure; a gap wider than 15 s
// means pause/navigation and is not counted. Memory-only state — a restart
// just skips one delta.
const lastTick = new Map<number, { at: number; videoId: string }>();

/** Active playback heartbeats, used by the small parent "now watching" panel. */
export function activeChildPlayback(maxAgeMs = 12_000) {
  const cutoff = Date.now() - maxAgeMs;
  return [...lastTick.entries()]
    .filter(([userId, tick]) => tick.at >= cutoff && isChildUser(userId))
    .map(([userId, tick]) => ({ userId, videoId: tick.videoId }));
}

export function recordWatchTick(userId: number, videoId: string) {
  if (isParentLocked(userId)) return;
  const now = Date.now();
  const last = lastTick.get(userId);
  lastTick.set(userId, { at: now, videoId });
  if (!last) return;
  const delta = (now - last.at) / 1000;
  if (delta <= 0 || delta > 15) return;
  db.prepare(
    `INSERT INTO watch_time_log (user_id, video_id, day, hour, seconds)
     VALUES (?, ?, date('now','localtime'), CAST(strftime('%H','now','localtime') AS INTEGER), ?)
     ON CONFLICT(user_id, video_id, day, hour) DO UPDATE SET seconds = seconds + excluded.seconds`
  ).run(userId, videoId, delta);
  recordWatchTagSignals(userId, videoId, delta);
}

/** The video the user was most recently watching (for "until video ends"). */
export function lastWatchedVideo(userId: number): string | null {
  return lastTick.get(userId)?.videoId ?? null;
}

function usedSecondsToday(userId: number): number {
  return (db.prepare("SELECT COALESCE(SUM(seconds), 0) AS s FROM watch_time_log WHERE user_id = ? AND day = ?")
    .get(userId, today()) as { s: number }).s;
}

// ---------- child-lock PIN lockout ----------

// Wrong child-lock PIN attempts (leaving the profile, approving extensions)
// count against the child profile; the third one locks it. The lock lives in
// user_settings so it survives restarts; the counter is memory-only.
const PIN_LOCK_MINUTES = 30;
const PIN_LOCK_ATTEMPTS = 3;
const pinFailures = new Map<number, number>();

export function isPinLocked(userId: number): boolean {
  const until = getUserSetting(userId, "child_pin_lock_until");
  return Boolean(until && Date.parse(until) > Date.now());
}

export function isParentLocked(userId: number): boolean {
  return getUserSetting(userId, "child_parent_locked") === "1";
}

export function lockChildByParent(userId: number) {
  setUserSetting(userId, "child_parent_locked", "1");
  lastTick.delete(userId);
}

/** Count one failed attempt; returns true when this attempt locked the profile. */
export function registerChildLockFailure(userId: number): boolean {
  if (!isChildUser(userId)) return false;
  const failures = (pinFailures.get(userId) ?? 0) + 1;
  pinFailures.set(userId, failures);
  if (failures < PIN_LOCK_ATTEMPTS) return false;
  pinFailures.delete(userId);
  setUserSetting(userId, "child_pin_lock_until", new Date(Date.now() + PIN_LOCK_MINUTES * 60_000).toISOString());
  return true;
}

export function clearChildLockFailures(userId: number) {
  pinFailures.delete(userId);
}

export function unlockChildProfile(userId: number) {
  pinFailures.delete(userId);
  setUserSetting(userId, "child_pin_lock_until", "");
  setUserSetting(userId, "child_parent_locked", "");
}

// ---------- status & grants ----------

export interface ChildStatus {
  is_child: boolean;
  limit_seconds: number | null;
  used_seconds: number;
  extra_seconds: number;
  unlimited_today: boolean;
  remaining_seconds: number | null;
  locked: boolean;
  lock_reason: "time" | "pin" | "parent" | null;
  local_only: boolean;
  hide_shorts: boolean;
  hide_live: boolean;
  downloads_only: boolean;
  has_pending_request: boolean;
}

export function childStatus(userId: number): ChildStatus {
  if (!isChildUser(userId)) {
    return {
      is_child: false, limit_seconds: null, used_seconds: 0, extra_seconds: 0,
      unlimited_today: false, remaining_seconds: null, locked: false, lock_reason: null,
      local_only: false, hide_shorts: false, hide_live: false, downloads_only: false,
      has_pending_request: false,
    };
  }
  const limit = childLimitSeconds(userId);
  const used = usedSecondsToday(userId);
  const extras = db.prepare("SELECT extra_seconds, unlimited FROM child_time_extras WHERE user_id = ? AND day = ?")
    .get(userId, today()) as { extra_seconds: number; unlimited: number } | null;
  const extra = extras?.extra_seconds ?? 0;
  const unlimited = extras?.unlimited === 1;
  const remaining = limit == null || unlimited ? null : Math.max(0, limit + extra - used);
  const pinLocked = isPinLocked(userId);
  const parentLocked = isParentLocked(userId);
  const timeLocked = remaining != null && remaining <= 0;
  const pending = db.prepare(
    "SELECT 1 FROM child_time_requests WHERE user_id = ? AND status = 'pending' AND created_at > datetime('now', '-1 hour')"
  ).get(userId);
  return {
    is_child: true,
    limit_seconds: limit,
    used_seconds: Math.round(used),
    extra_seconds: Math.round(extra),
    unlimited_today: unlimited,
    remaining_seconds: remaining == null ? null : Math.round(remaining),
    locked: pinLocked || parentLocked || timeLocked,
    lock_reason: parentLocked ? "parent" : pinLocked ? "pin" : timeLocked ? "time" : null,
    local_only: getUserSetting(userId, "child_local_only") === "1",
    hide_shorts: getUserSetting(userId, "child_hide_shorts") === "1",
    hide_live: getUserSetting(userId, "child_hide_live") === "1",
    downloads_only: getUserSetting(userId, "child_downloads_only") === "1",
    has_pending_request: Boolean(pending),
  };
}

/** Child profile restricted to locally downloaded files (no YouTube playback). */
export function childDownloadsOnly(userId: number): boolean {
  return isChildUser(userId) && getUserSetting(userId, "child_downloads_only") === "1";
}

export function childLocalOnly(userId: number): boolean {
  return isChildUser(userId) && getUserSetting(userId, "child_local_only") === "1";
}

export function childHidesLive(userId: number): boolean {
  return isChildUser(userId) && getUserSetting(userId, "child_hide_live") === "1";
}

export function applyGrant(userId: number, grant: ChildGrant, videoId: string | null) {
  const day = today();
  if (grant === "today_off") {
    db.prepare(
      `INSERT INTO child_time_extras (user_id, day, unlimited) VALUES (?, ?, 1)
       ON CONFLICT(user_id, day) DO UPDATE SET unlimited = 1`
    ).run(userId, day);
    return;
  }
  let seconds = grant === "1h" ? 3600 : 900;
  if (grant === "video_end" && videoId) {
    const row = db.prepare(
      "SELECT watch_position, watch_duration FROM user_videos WHERE user_id = ? AND video_id = ?"
    ).get(userId, videoId) as { watch_position: number | null; watch_duration: number | null } | null;
    if (row?.watch_duration && row.watch_position != null) {
      // Remaining runtime plus a small buffer so the video can actually finish.
      seconds = Math.max(60, Math.round(row.watch_duration - row.watch_position) + 60);
    }
  }
  // The grant means "this much time from now": raise the extras so remaining
  // time equals the grant even when usage overshot the limit (a slow lock,
  // another device), but never shrink extras that are already larger.
  const limit = childLimitSeconds(userId) ?? 0;
  const used = usedSecondsToday(userId);
  const current = (db.prepare("SELECT extra_seconds FROM child_time_extras WHERE user_id = ? AND day = ?")
    .get(userId, day) as { extra_seconds: number } | null)?.extra_seconds ?? 0;
  const extra = Math.max(current + seconds, Math.round(used - limit + seconds));
  db.prepare(
    `INSERT INTO child_time_extras (user_id, day, extra_seconds) VALUES (?, ?, ?)
     ON CONFLICT(user_id, day) DO UPDATE SET extra_seconds = excluded.extra_seconds`
  ).run(userId, day, extra);
}
