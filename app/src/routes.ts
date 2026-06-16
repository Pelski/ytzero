import { Hono } from "hono";
import { db, getSetting, setSetting, SETTING_DEFAULTS } from "./db";
import {
  type ChannelAbout,
  fetchChannelAbout,
  fetchChannelFeed,
  fetchChannelPlaylists,
  fetchChannelVideosDurations,
  fetchPlaylistVideos,
  fetchVideoChapters,
  fetchVideoInfo,
  parseOpml,
  parseTakeoutCsv,
  resolveChannelId,
  searchYouTube,
} from "./youtube";
import { getCachedImage } from "./imgcache";
import { importPlaylistVideos, refreshAll, refreshChannel, refreshLiveStatus, syncChannel } from "./refresher";
import { applyRuleToAllVideos } from "./autotags";
import { applyPlaylistRuleToAllVideos, applyPlaylistRulesForPlaylist } from "./userPlaylists";
import { applyFilterRuleToAll } from "./filterRules";
import { log, readRecentLogs } from "./logger";

export const api = new Hono();

api.onError((err, c) => {
  log.error("api.unhandled_error", { path: c.req.path, method: c.req.method, error: err.message });
  return c.json({ error: err.message }, 500);
});

// ---------- helpers ----------

const CHILD_LOCK_SESSION_COOKIE = "ytzero_child_lock";
const CHILD_LOCK_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const childLockSessions = new Map<string, number>();

function parseCookies(header: string | undefined) {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (!rawKey) continue;
    cookies[rawKey] = decodeURIComponent(rawValue.join("="));
  }
  return cookies;
}

function isSixDigitPin(pin: unknown): pin is string {
  return typeof pin === "string" && /^\d{6}$/.test(pin);
}

function isChildLockEnabled() {
  return getSetting("child_lock_enabled") === "1" && Boolean(getSetting("child_lock_pin_hash"));
}

function cleanupChildLockSessions() {
  const now = Date.now();
  for (const [token, expiresAt] of childLockSessions) {
    if (expiresAt <= now) childLockSessions.delete(token);
  }
}

function hasChildLockSession(c: any) {
  if (!isChildLockEnabled()) return true;
  cleanupChildLockSessions();
  const token = parseCookies(c.req.header("cookie"))[CHILD_LOCK_SESSION_COOKIE];
  return Boolean(token && (childLockSessions.get(token) ?? 0) > Date.now());
}

function childLockStatus(c: any) {
  const enabled = isChildLockEnabled();
  return { enabled, locked: enabled && !hasChildLockSession(c) };
}

async function verifyChildLockPin(pin: string) {
  const hash = getSetting("child_lock_pin_hash");
  if (!hash) return false;
  return Bun.password.verify(pin, hash);
}

async function hashChildLockPin(pin: string) {
  return Bun.password.hash(pin);
}

function setChildLockSession(c: any) {
  const token = crypto.randomUUID();
  const expiresAt = Date.now() + CHILD_LOCK_SESSION_TTL_MS;
  childLockSessions.set(token, expiresAt);
  c.header(
    "Set-Cookie",
    `${CHILD_LOCK_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${Math.floor(CHILD_LOCK_SESSION_TTL_MS / 1000)}; SameSite=Lax; HttpOnly`
  );
}

function clearChildLockSession(c: any) {
  const token = parseCookies(c.req.header("cookie"))[CHILD_LOCK_SESSION_COOKIE];
  if (token) childLockSessions.delete(token);
  c.header("Set-Cookie", `${CHILD_LOCK_SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly`);
}

const SETTINGS_MUTATION_PREFIXES = [
  "/settings",
  "/channels",
  "/tags",
  "/rules",
  "/filter-rules",
  "/playlists",
];

api.use("*", async (c, next) => {
  const path = new URL(c.req.url).pathname.replace(/^\/api/, "");
  const method = c.req.method.toUpperCase();
  const isMutation = !["GET", "HEAD", "OPTIONS"].includes(method);
  const isProtected = SETTINGS_MUTATION_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  if (isMutation && isProtected && !path.startsWith("/child-lock") && !hasChildLockSession(c)) {
    return c.json({ error: "settings locked" }, 423);
  }
  await next();
});

interface VideoRow {
  video_id: string;
  channel_id: string;
  title: string;
  description: string;
  thumbnail: string;
  published_at: string | null;
  live_status: string;
  status: string;
  bucket: string | null;
  is_short: number | null;
  views: number | null;
  likes: number | null;
  liked: number | null;
  in_history: number;
  channel_title: string;
}

function attachTags(videos: VideoRow[]) {
  if (videos.length === 0) return [];
  const ids = videos.map((v) => v.video_id);
  const ph = ids.map(() => "?").join(",");
  const videoTags = db
    .prepare(
      `SELECT vt.video_id, t.id, t.name, t.color, t.filter_only, vt.source FROM video_tags vt
       JOIN tags t ON t.id = vt.tag_id WHERE vt.video_id IN (${ph})`
    )
    .all(...ids) as any[];
  const channelIds = [...new Set(videos.map((v) => v.channel_id))];
  const chPh = channelIds.map(() => "?").join(",");
  const channelTags = db
    .prepare(
      `SELECT ct.channel_id, t.id, t.name, t.color, t.filter_only FROM channel_tags ct
       JOIN tags t ON t.id = ct.tag_id WHERE ct.channel_id IN (${chPh})`
    )
    .all(...channelIds) as any[];

  return videos.map((v) => {
    const own = videoTags
      .filter((t) => t.video_id === v.video_id)
      .map((t) => ({ id: t.id, name: t.name, color: t.color, filter_only: t.filter_only, source: t.source }));
    const inherited = channelTags
      .filter((t) => t.channel_id === v.channel_id && !own.some((o) => o.id === t.id))
      .map((t) => ({ id: t.id, name: t.name, color: t.color, filter_only: t.filter_only, source: "channel" }));
    return { ...v, tags: [...own, ...inherited] };
  });
}

/** WHERE fragment excluding videos that have a filter_only tag unless one of those tags is selected. */
function filterOnlySql(tagIds: number[]) {
  const noFO = `(NOT EXISTS (SELECT 1 FROM video_tags vt2 JOIN tags t2 ON t2.id = vt2.tag_id WHERE vt2.video_id = v.video_id AND t2.filter_only = 1)
     AND NOT EXISTS (SELECT 1 FROM channel_tags ct2 JOIN tags t2 ON t2.id = ct2.tag_id WHERE ct2.channel_id = v.channel_id AND t2.filter_only = 1))`;
  if (tagIds.length === 0) return { sql: noFO, params: [] };
  const ph = tagIds.map(() => "?").join(",");
  return {
    sql: `(${noFO} OR EXISTS (SELECT 1 FROM video_tags vt3 JOIN tags t3 ON t3.id = vt3.tag_id WHERE vt3.video_id = v.video_id AND t3.filter_only = 1 AND t3.id IN (${ph})) OR EXISTS (SELECT 1 FROM channel_tags ct3 JOIN tags t3 ON t3.id = ct3.tag_id WHERE ct3.channel_id = v.channel_id AND t3.filter_only = 1 AND t3.id IN (${ph})))`,
    params: [...tagIds, ...tagIds],
  };
}

/** WHERE fragment matching videos that have ANY of the given tags (own or via channel). */
function tagFilterSql(tagIds: number[]) {
  const ph = tagIds.map(() => "?").join(",");
  return {
    sql: `(EXISTS (SELECT 1 FROM video_tags vt WHERE vt.video_id = v.video_id AND vt.tag_id IN (${ph}))
       OR EXISTS (SELECT 1 FROM channel_tags ct WHERE ct.channel_id = v.channel_id AND ct.tag_id IN (${ph})))`,
    params: [...tagIds, ...tagIds],
  };
}

const BASE_SELECT = `
  SELECT v.video_id, v.channel_id, v.title, v.description, v.thumbnail,
         v.published_at, v.live_status, v.status, v.bucket, v.show_from, v.is_short, v.views, v.likes, v.liked,
         v.duration, v.watch_position, v.watch_duration, v.external,
         EXISTS(SELECT 1 FROM history h WHERE h.video_id = v.video_id) AS in_history,
         c.title AS channel_title, c.thumbnail AS channel_thumbnail, c.subscriber_count AS channel_subscriber_count
  FROM videos v JOIN channels c ON c.channel_id = v.channel_id`;

function localSQLite(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:00`;
}

function computeShowFrom(bucket: string): string {
  const now = new Date();
  const d = new Date(now);
  const h = now.getHours();

  if (bucket === "today") {
    return localSQLite(now);
  } else if (bucket === "tonight") {
    // Today at 19:00 if before, otherwise immediately.
    if (h < 19) d.setHours(19, 0, 0, 0);
    else return localSQLite(now);
  } else if (bucket === "tomorrow") {
    // Always tomorrow 06:00
    d.setDate(d.getDate() + 1);
    d.setHours(6, 0, 0, 0);
  } else if (bucket === "weekend") {
    const day = d.getDay(); // 0=Sun, 6=Sat
    if (day === 0 || day === 6) {
      return localSQLite(now); // already weekend → now
    }
    const daysUntilSat = (6 - day + 7) % 7;
    d.setDate(d.getDate() + daysUntilSat);
    d.setHours(0, 0, 0, 0);
  }
  return localSQLite(d);
}

// ---------- feed ----------

api.get("/feed", (c) => {
  const page = Math.max(0, Number(c.req.query("page") ?? 0));
  const limit = Math.min(100, Number(c.req.query("limit") ?? 40));
  const q = c.req.query("q")?.trim();
  const channel = c.req.query("channel");
  const tagsParam = c.req.query("tags"); // comma-separated tag ids
  const status = c.req.query("status") ?? "inbox"; // inbox | all
  const allSources = c.req.query("all_sources") === "1";

  const where: string[] = [];
  const params: any[] = [];
  if (status !== "all") {
    where.push("v.status = ?");
    params.push(status);
  }
  if (channel) {
    where.push("v.channel_id = ?");
    params.push(channel);
  } else if (!allSources) {
    where.push("c.followed = 1");
    where.push("v.external = 0");
  }
  if (q) {
    where.push("(v.title LIKE ? OR v.description LIKE ?)");
    params.push(`%${q}%`, `%${q}%`);
  }
  // shorts=1 forces shorts in, shorts=0 forces them out; otherwise the global
  // setting decides.
  const shortsParam = c.req.query("shorts");
  if (shortsParam === "0" || (shortsParam !== "1" && getSetting("show_shorts") !== "1")) {
    where.push("COALESCE(v.is_short, 0) = 0");
  }
  if (c.req.query("only_shorts") === "1") {
    where.push("v.is_short = 1");
  }
  if (c.req.query("liked") === "1") {
    where.push("v.liked = 1");
  }
  const tagIds = tagsParam ? tagsParam.split(",").map(Number).filter(Boolean) : [];
  if (tagIds.length) {
    const f = tagFilterSql(tagIds);
    where.push(f.sql);
    params.push(...f.params);
  }
  // Exclude filter_only-tagged videos unless the relevant tag is actively selected
  if (!channel && !allSources) {
    const fo = filterOnlySql(tagIds);
    where.push(fo.sql);
    params.push(...fo.params);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = db
    .prepare(`${BASE_SELECT} ${whereSql} ORDER BY v.published_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, page * limit) as VideoRow[];
  return c.json({ videos: attachTags(rows), page, limit });
});

api.get("/in-progress", (c) => {
  const rows = db.prepare(`
    ${BASE_SELECT}
    JOIN (SELECT video_id, MAX(watched_at) AS last_watched FROM history GROUP BY video_id) lw ON lw.video_id = v.video_id
    WHERE v.watch_position IS NOT NULL AND v.watch_duration IS NOT NULL
      AND v.watch_duration > 30
      AND v.watch_position >= 3
      AND CAST(v.watch_position AS REAL) / v.watch_duration < 0.92
      AND v.status = 'inbox'
      AND c.followed = 1
    ORDER BY lw.last_watched DESC
    LIMIT 20
  `).all() as VideoRow[];
  return c.json({ videos: attachTags(rows) });
});

api.get("/search/youtube", async (c) => {
  const q = c.req.query("q");
  if (!q?.trim()) return c.json({ results: [] });
  try {
    return c.json({ results: await searchYouTube(q.trim()) });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

api.get("/live", (c) => {
  const rows = db
    .prepare(`${BASE_SELECT} WHERE v.live_status IN ('live','upcoming') ORDER BY v.live_status = 'live' DESC, v.published_at DESC`)
    .all() as VideoRow[];
  return c.json({ videos: attachTags(rows) });
});

api.get("/watchlist", (c) => {
  const rows = db
    .prepare(`${BASE_SELECT} WHERE v.status = 'queued' ORDER BY v.queued_at DESC`)
    .all() as VideoRow[];
  return c.json({ videos: attachTags(rows) });
});

api.get("/archive", (c) => {
  const page = Math.max(0, Number(c.req.query("page") ?? 0));
  const rows = db
    .prepare(`${BASE_SELECT} WHERE v.status = 'archived' ORDER BY v.published_at DESC LIMIT 60 OFFSET ?`)
    .all(page * 60) as VideoRow[];
  return c.json({ videos: attachTags(rows), page });
});

// External ("orphan") videos pulled in for one-off watching: anything that
// belongs to an external channel (not followed, brought in just to watch).
// Watched ones (with a saved position) float to the top.
api.get("/external", (c) => {
  const rows = db
    .prepare(`${BASE_SELECT} WHERE c.external = 1
      ORDER BY (v.watch_position IS NOT NULL) DESC, v.created_at DESC LIMIT 200`)
    .all() as VideoRow[];
  return c.json({ videos: attachTags(rows) });
});

// Clear orphan externals. Protects anything the user actively saved
// (queued, liked or added to a playlist), then drops now-empty external channels.
api.delete("/external", (c) => {
  const res = db.prepare(`
    DELETE FROM videos
    WHERE channel_id IN (SELECT channel_id FROM channels WHERE external = 1)
      AND status != 'queued'
      AND COALESCE(liked, 0) = 0
      AND video_id NOT IN (SELECT video_id FROM user_playlist_videos)
  `).run();
  db.prepare(`
    DELETE FROM channels
    WHERE external = 1 AND channel_id NOT IN (SELECT DISTINCT channel_id FROM videos)
  `).run();
  return c.json({ deleted: res.changes });
});

// Remove a single external video, then drop its channel if now empty + external.
api.delete("/external/:id", (c) => {
  const id = c.req.param("id");
  const res = db.prepare(`
    DELETE FROM videos
    WHERE video_id = ?
      AND channel_id IN (SELECT channel_id FROM channels WHERE external = 1)
  `).run(id);
  db.prepare(`
    DELETE FROM channels
    WHERE external = 1 AND channel_id NOT IN (SELECT DISTINCT channel_id FROM videos)
  `).run();
  return c.json({ deleted: res.changes });
});

api.get("/videos/:id/info", async (c) => {
  try {
    const info = await fetchVideoInfo(c.req.param("id"));
    // Channel avatar + the channel's recent uploads (for the "related" panel).
    const [about, feed] = await Promise.all([
      fetchChannelAbout(info.channelId).catch(() => null),
      fetchChannelFeed(info.channelId).catch(() => null),
    ]);
    const avatar = about?.avatar ?? "";

    // Upsert channel: insert as external if new, or update avatar if missing
    db.prepare(`
      INSERT INTO channels (channel_id, title, url, thumbnail, followed, external)
      VALUES (?, ?, ?, ?, 0, 1)
      ON CONFLICT(channel_id) DO UPDATE SET
        thumbnail = CASE WHEN channels.thumbnail = '' OR channels.thumbnail IS NULL
                         THEN excluded.thumbnail ELSE channels.thumbnail END
    `).run(info.channelId, info.channelTitle, `https://www.youtube.com/channel/${info.channelId}`, avatar);

    const insertVideo = db.prepare(`
      INSERT OR IGNORE INTO videos
        (video_id, channel_id, title, description, thumbnail, published_at, live_status, status, views, duration, external)
      VALUES (?, ?, ?, ?, ?, ?, 'none', 'inbox', ?, ?, 1)
    `);

    // Insert the watched video (no-op if already in DB as a real video)
    const inserted = insertVideo.run(
      info.videoId, info.channelId, info.title, info.description,
      info.thumbnail, info.publishedAt, info.viewCount, info.duration
    );

    // Insert the channel's recent uploads as external so the related panel fills.
    if (feed) {
      const insertMany = db.transaction((videos: typeof feed.videos) => {
        for (const v of videos) {
          insertVideo.run(
            v.videoId, info.channelId, v.title, v.description,
            v.thumbnail, v.publishedAt, v.views, null
          );
        }
      });
      insertMany(feed.videos);
    }
    log.info("external.video_info_loaded", {
      videoId: info.videoId,
      channelId: info.channelId,
      inserted: inserted.changes > 0,
      relatedImported: feed?.videos.length ?? 0,
    });
    return c.json({ info });
  } catch (e) {
    log.error("external.video_info_failed", { videoId: c.req.param("id"), error: e instanceof Error ? e.message : String(e) });
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

async function refreshVideoChapters(videoId: string) {
  const chapters = await fetchVideoChapters(videoId);
  // Persist only when the video is in our DB (UPDATE no-ops otherwise).
  db.prepare("UPDATE videos SET chapters_json = ?, chapters_fetched_at = datetime('now') WHERE video_id = ?")
    .run(JSON.stringify(chapters), videoId);
  return chapters;
}

api.get("/videos/:id/chapters", async (c) => {
  const videoId = c.req.param("id");
  const cached = db.prepare("SELECT chapters_json, chapters_fetched_at FROM videos WHERE video_id = ?")
    .get(videoId) as { chapters_json: string | null; chapters_fetched_at: string | null } | null;

  if (cached?.chapters_json) {
    if (ageMs(cached.chapters_fetched_at) > CHAPTERS_DB_TTL) {
      refreshVideoChapters(videoId).catch(() => {});
    }
    try {
      return c.json({ chapters: JSON.parse(cached.chapters_json) });
    } catch { /* corrupted cache — fall through */ }
  }

  try {
    return c.json({ chapters: await refreshVideoChapters(videoId) });
  } catch {
    return c.json({ chapters: [] });
  }
});

api.get("/videos/:id", (c) => {
  const row = db
    .prepare(`${BASE_SELECT} WHERE v.video_id = ?`)
    .get(c.req.param("id")) as VideoRow | null;
  if (!row) return c.json({ error: "not found" }, 404);
  const [video] = attachTags([row]);

  // Collect all tag IDs for this video (direct + via channel)
  const tagRows = db.prepare(`
    SELECT DISTINCT tag_id FROM (
      SELECT tag_id FROM video_tags WHERE video_id = ?
      UNION
      SELECT tag_id FROM channel_tags WHERE channel_id = ?
    )
  `).all(row.video_id, row.channel_id) as { tag_id: number }[];

  const RELATED_TARGET = 15;
  const seen = new Set<string>([row.video_id]);
  const related: VideoRow[] = [];

  const fill = (rows: VideoRow[]) => {
    for (const r of rows) {
      if (seen.has(r.video_id) || r.is_short === 1) continue;
      seen.add(r.video_id);
      related.push(r);
      if (related.length >= RELATED_TARGET) break;
    }
  };

  const need = () => RELATED_TARGET - related.length;

  // Step 1 — same tags (own + channel-inherited), non-archived, most recent
  if (tagRows.length > 0) {
    const tagIds = tagRows.map((t) => t.tag_id);
    const ph = tagIds.map(() => "?").join(",");
    fill(db.prepare(
      `${BASE_SELECT} WHERE v.video_id != ? AND v.status != 'archived' AND v.is_short IS NOT 1
       AND (EXISTS (SELECT 1 FROM video_tags vt WHERE vt.video_id = v.video_id AND vt.tag_id IN (${ph}))
         OR EXISTS (SELECT 1 FROM channel_tags ct WHERE ct.channel_id = v.channel_id AND ct.tag_id IN (${ph})))
       ORDER BY v.published_at DESC LIMIT ?`
    ).all(row.video_id, ...tagIds, ...tagIds, RELATED_TARGET) as VideoRow[]);
  }

  // Step 2 — same channel, fill what's missing
  if (need() > 0) {
    fill(db.prepare(
      `${BASE_SELECT} WHERE v.channel_id = ? AND v.video_id != ? AND v.status != 'archived' AND v.is_short IS NOT 1
       ORDER BY v.published_at DESC LIMIT ?`
    ).all(row.channel_id, row.video_id, need() * 2) as VideoRow[]);
  }

  // Step 3 — other channels with any shared tag, fill what's missing
  if (need() > 0 && tagRows.length > 0) {
    const tagIds = tagRows.map((t) => t.tag_id);
    const ph = tagIds.map(() => "?").join(",");
    const seenPh = [...seen].map(() => "?").join(",");
    fill(db.prepare(
      `${BASE_SELECT} WHERE v.video_id NOT IN (${seenPh}) AND v.status != 'archived' AND v.is_short IS NOT 1
       AND (EXISTS (SELECT 1 FROM video_tags vt WHERE vt.video_id = v.video_id AND vt.tag_id IN (${ph}))
         OR EXISTS (SELECT 1 FROM channel_tags ct WHERE ct.channel_id = v.channel_id AND ct.tag_id IN (${ph})))
       ORDER BY v.published_at DESC LIMIT ?`
    ).all(...seen, ...tagIds, ...tagIds, need() * 2) as VideoRow[]);
  }

  // Step 4 — any recent non-archived non-short inbox/queued videos
  if (need() > 0) {
    const seenPh = [...seen].map(() => "?").join(",");
    fill(db.prepare(
      `${BASE_SELECT} WHERE v.video_id NOT IN (${seenPh}) AND v.status NOT IN ('archived') AND v.is_short IS NOT 1
       ORDER BY v.published_at DESC LIMIT ?`
    ).all(...seen, need() * 2) as VideoRow[]);
  }

  return c.json({ video, related: attachTags(related) });
});

// ---------- video actions ----------

const BUCKETS = ["today", "tonight", "tomorrow", "weekend"];

api.post("/videos/:id/queue", async (c) => {
  const { bucket } = await c.req.json();
  if (!BUCKETS.includes(bucket)) return c.json({ error: "invalid bucket" }, 400);
  const showFrom = computeShowFrom(bucket);
  db.prepare(
    "UPDATE videos SET status = 'queued', bucket = ?, queued_at = datetime('now'), show_from = ? WHERE video_id = ?"
  ).run(bucket, showFrom, c.req.param("id"));
  return c.json({ ok: true });
});

api.post("/videos/:id/archive", (c) => {
  db.prepare("UPDATE videos SET status = 'archived', bucket = NULL, show_from = NULL WHERE video_id = ?").run(c.req.param("id"));
  return c.json({ ok: true });
});

api.post("/videos/:id/restore", (c) => {
  db.prepare("UPDATE videos SET status = 'inbox', bucket = NULL, show_from = NULL WHERE video_id = ?").run(c.req.param("id"));
  return c.json({ ok: true });
});

api.post("/videos/:id/dequeue", (c) => {
  db.prepare("UPDATE videos SET status = 'inbox', bucket = NULL, queued_at = NULL, show_from = NULL WHERE video_id = ?").run(c.req.param("id"));
  return c.json({ ok: true });
});

api.post("/videos/:id/watch", (c) => {
  const id = c.req.param("id");
  const exists = db.prepare("SELECT 1 FROM videos WHERE video_id = ?").get(id);
  if (exists) db.prepare("INSERT INTO history (video_id) VALUES (?)").run(id);
  return c.json({ ok: true });
});

api.put("/videos/:id/like", async (c) => {
  const { liked } = await c.req.json() as { liked: boolean };
  db.prepare("UPDATE videos SET liked = ? WHERE video_id = ?").run(liked ? 1 : null, c.req.param("id"));
  return c.json({ ok: true });
});

api.put("/videos/:id/progress", async (c) => {
  const id = c.req.param("id");
  const { position, duration } = await c.req.json() as { position: number; duration: number };
  db.prepare("UPDATE videos SET watch_position = ?, watch_duration = ? WHERE video_id = ?").run(position, duration, id);
  return c.json({ ok: true });
});

api.delete("/videos/:id/progress", (c) => {
  db.prepare("UPDATE videos SET watch_position = NULL, watch_duration = NULL WHERE video_id = ?").run(c.req.param("id"));
  return c.json({ ok: true });
});

api.post("/videos/:id/tags", async (c) => {
  const { tag_id } = await c.req.json();
  db.prepare("INSERT OR IGNORE INTO video_tags (video_id, tag_id, source) VALUES (?, ?, 'manual')").run(
    c.req.param("id"),
    tag_id
  );
  return c.json({ ok: true });
});

api.delete("/videos/:id/tags/:tagId", (c) => {
  db.prepare("DELETE FROM video_tags WHERE video_id = ? AND tag_id = ?").run(
    c.req.param("id"),
    c.req.param("tagId")
  );
  return c.json({ ok: true });
});

// ---------- history ----------

api.get("/history", (c) => {
  const page = Math.max(0, Number(c.req.query("page") ?? 0));
  const rows = db
    .prepare(
      `SELECT MAX(h.id) AS history_id, MAX(h.watched_at) AS watched_at,
              v.video_id, v.channel_id, v.title, v.description, v.duration,
              v.thumbnail, v.published_at, v.live_status, v.status, v.bucket,
              v.watch_position, v.watch_duration,
              c.title AS channel_title, c.thumbnail AS channel_thumbnail
       FROM history h JOIN videos v ON v.video_id = h.video_id
       JOIN channels c ON c.channel_id = v.channel_id
       GROUP BY v.video_id
       ORDER BY MAX(h.watched_at) DESC LIMIT 60 OFFSET ?`
    )
    .all(page * 60) as (VideoRow & { history_id: number; watched_at: string })[];
  return c.json({ videos: attachTags(rows as VideoRow[]), page });
});

api.delete("/history/:id", (c) => {
  db.prepare("DELETE FROM history WHERE id = ?").run(c.req.param("id"));
  return c.json({ ok: true });
});

// ---------- channels ----------

api.get("/channels", (c) => {
  const channels = db.prepare("SELECT * FROM channels WHERE external = 0 ORDER BY title COLLATE NOCASE").all() as any[];
  const tags = db
    .prepare(
      `SELECT ct.channel_id, t.id, t.name, t.color FROM channel_tags ct JOIN tags t ON t.id = ct.tag_id`
    )
    .all() as any[];
  return c.json({
    channels: channels.map((ch) => ({
      ...ch,
      tags: tags.filter((t) => t.channel_id === ch.channel_id).map((t) => ({ id: t.id, name: t.name, color: t.color })),
    })),
  });
});

api.post("/channels", async (c) => {
  const { url } = await c.req.json();
  if (!url) return c.json({ error: "url required" }, 400);
  const info = await resolveChannelId(url);
  const inserted = db.prepare(
    "INSERT OR IGNORE INTO channels (channel_id, title, url, thumbnail) VALUES (?, ?, ?, ?)"
  ).run(info.channelId, info.title, `https://www.youtube.com/channel/${info.channelId}`, info.thumbnail);
  log.info("channel.added", { channelId: info.channelId, title: info.title, inserted: inserted.changes > 0 });
  refreshChannel(info.channelId)
    .then(() => refreshLiveStatus(info.channelId))
    .catch((e) => log.error("channel.initial_refresh_failed", { channelId: info.channelId, error: e instanceof Error ? e.message : String(e) }));
  return c.json({ ok: true, channel_id: info.channelId, title: info.title });
});

api.delete("/channels/:id", (c) => {
  db.prepare("DELETE FROM channels WHERE channel_id = ?").run(c.req.param("id"));
  return c.json({ ok: true });
});

api.post("/channels/:id/tags", async (c) => {
  const { tag_id } = await c.req.json();
  const channelId = c.req.param("id");
  db.prepare("INSERT OR IGNORE INTO channel_tags (channel_id, tag_id) VALUES (?, ?)").run(channelId, tag_id);
  // Propagate to all existing videos of this channel
  db.prepare(
    "INSERT OR IGNORE INTO video_tags (video_id, tag_id, source) SELECT video_id, ?, 'channel' FROM videos WHERE channel_id = ?"
  ).run(tag_id, channelId);
  return c.json({ ok: true });
});

api.delete("/channels/:id/tags/:tagId", (c) => {
  const channelId = c.req.param("id");
  const tagId = c.req.param("tagId");
  db.prepare("DELETE FROM channel_tags WHERE channel_id = ? AND tag_id = ?").run(channelId, tagId);
  // Remove channel-propagated tags from videos (keep manually added ones)
  db.prepare(
    "DELETE FROM video_tags WHERE tag_id = ? AND source = 'channel' AND video_id IN (SELECT video_id FROM videos WHERE channel_id = ?)"
  ).run(tagId, channelId);
  return c.json({ ok: true });
});

/** Milliseconds since a SQLite datetime('now') timestamp (stored as UTC). */
function ageMs(ts: string | null): number {
  if (!ts) return Infinity;
  const t = Date.parse(ts.replace(" ", "T") + "Z");
  return Number.isFinite(t) ? Date.now() - t : Infinity;
}

const ABOUT_DB_TTL = 3 * 24 * 60 * 60_000;
const PLAYLISTS_DB_TTL = 3 * 24 * 60 * 60_000;
const CHAPTERS_DB_TTL = 7 * 24 * 60 * 60_000;

function persistChannelAbout(channelId: string, about: ChannelAbout) {
  db.prepare(
    `UPDATE channels SET about_json = ?, about_fetched_at = datetime('now'),
       thumbnail = COALESCE(?, thumbnail), title = COALESCE(?, title), subscriber_count = COALESCE(?, subscriber_count)
     WHERE channel_id = ?`
  ).run(JSON.stringify(about), about.avatar || null, about.title || null, about.stats[0] ?? null, channelId);
}

/** Fetch about from YouTube, persist it, and backfill video durations. */
async function refreshChannelAbout(channelId: string): Promise<ChannelAbout> {
  const about = await fetchChannelAbout(channelId);
  persistChannelAbout(channelId, about);
  fetchChannelVideosDurations(channelId).then((durations) => {
    const upd = db.prepare("UPDATE videos SET duration = ? WHERE video_id = ? AND duration IS NULL");
    for (const d of durations) upd.run(d.duration, d.videoId);
  }).catch(() => {});
  return about;
}

api.get("/channels/:id/about", async (c) => {
  const channelId = c.req.param("id");
  // Real counts from our own data — stable regardless of how many pages the
  // UI has loaded (NULL is_short counts as a regular video, matching the UI).
  const row = db.prepare(
    "SELECT COUNT(*) AS total, COALESCE(SUM(is_short = 1), 0) AS shorts FROM videos WHERE channel_id = ?"
  ).get(channelId) as { total: number; shorts: number };
  const counts = { videos: row.total - row.shorts, shorts: row.shorts };

  // Serve the cached about from the DB; only touch YouTube when it's missing
  // or stale (and then in the background, so the page never waits on it).
  const cachedRow = db.prepare("SELECT about_json, about_fetched_at FROM channels WHERE channel_id = ?")
    .get(channelId) as { about_json: string | null; about_fetched_at: string | null } | null;

  if (cachedRow?.about_json) {
    if (ageMs(cachedRow.about_fetched_at) > ABOUT_DB_TTL) {
      refreshChannelAbout(channelId).catch((e) =>
        log.warn("channel.about.refresh_failed", { channelId, error: e instanceof Error ? e.message : String(e) }));
    }
    try {
      return c.json({ ...(JSON.parse(cachedRow.about_json) as ChannelAbout), counts });
    } catch {
      // corrupted cache — fall through to a fresh fetch
    }
  }

  // No usable cache: fetch synchronously this once, then it's served from DB.
  try {
    return c.json({ ...(await refreshChannelAbout(channelId)), counts });
  } catch (e) {
    // YouTube can rate-limit (429) or change layout — fall back to the basic
    // columns so the page still shows avatar/title/subs instead of breaking.
    const ch = db.prepare("SELECT title, thumbnail, subscriber_count FROM channels WHERE channel_id = ?")
      .get(channelId) as { title: string; thumbnail: string | null; subscriber_count: string | null } | null;
    if (!ch) return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
    log.warn("channel.about.fallback", { channelId, error: e instanceof Error ? e.message : String(e) });
    return c.json({
      channelId,
      title: ch.title ?? "",
      description: "",
      avatar: ch.thumbnail ?? "",
      banner: "",
      stats: ch.subscriber_count ? [ch.subscriber_count] : [],
      links: [],
      joinedDate: "",
      viewCount: "",
      handle: "",
      counts,
    });
  }
});

async function refreshChannelPlaylists(channelId: string) {
  const playlists = await fetchChannelPlaylists(channelId);
  db.prepare("UPDATE channels SET playlists_json = ?, playlists_fetched_at = datetime('now') WHERE channel_id = ?")
    .run(JSON.stringify(playlists), channelId);
  return playlists;
}

api.get("/channels/:id/playlists", async (c) => {
  const channelId = c.req.param("id");
  const cached = db.prepare("SELECT playlists_json, playlists_fetched_at FROM channels WHERE channel_id = ?")
    .get(channelId) as { playlists_json: string | null; playlists_fetched_at: string | null } | null;

  if (cached?.playlists_json) {
    if (ageMs(cached.playlists_fetched_at) > PLAYLISTS_DB_TTL) {
      refreshChannelPlaylists(channelId).catch((e) =>
        log.warn("channel.playlists.refresh_failed", { channelId, error: e instanceof Error ? e.message : String(e) }));
    }
    try {
      return c.json({ playlists: JSON.parse(cached.playlists_json) });
    } catch { /* corrupted cache — fall through */ }
  }

  try {
    return c.json({ playlists: await refreshChannelPlaylists(channelId) });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

api.put("/channels/:id/follow", async (c) => {
  const { followed } = await c.req.json<{ followed: boolean }>();
  db.prepare("UPDATE channels SET followed = ? WHERE channel_id = ?").run(followed ? 1 : 0, c.req.param("id"));
  return c.json({ ok: true });
});

// Literal paths before parameterised /channels/:id to avoid shadowing
api.get("/channels/unfollowed", (c) => {
  const channels = db.prepare("SELECT * FROM channels WHERE followed = 0 AND external = 0 ORDER BY title COLLATE NOCASE").all() as any[];
  return c.json({ channels });
});

api.get("/channels/recent", (c) => {
  const shortsFilter = getSetting("show_shorts") === "1"
    ? ""
    : "AND COALESCE(is_short, 0) = 0";
  const rows = db.prepare(`
    SELECT c.channel_id, c.title, c.thumbnail,
           (SELECT thumbnail FROM videos WHERE channel_id = c.channel_id ${shortsFilter} ORDER BY published_at DESC LIMIT 1) AS latest_thumbnail,
           (SELECT video_id FROM videos WHERE channel_id = c.channel_id ${shortsFilter} ORDER BY published_at DESC LIMIT 1) AS latest_video_id
    FROM channels c
    WHERE c.followed = 1
    ORDER BY COALESCE(
      (SELECT published_at FROM videos WHERE channel_id = c.channel_id ${shortsFilter} ORDER BY published_at DESC LIMIT 1),
      '1970-01-01'
    ) DESC
    LIMIT 20
  `).all() as any[];
  return c.json({ channels: rows });
});

api.get("/channels/:id", (c) => {
  const ch = db.prepare("SELECT * FROM channels WHERE channel_id = ?").get(c.req.param("id")) as any;
  if (!ch) return c.json({ error: "not found" }, 404);
  const tags = db
    .prepare(
      `SELECT t.id, t.name, t.color FROM channel_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.channel_id = ?`
    )
    .all(c.req.param("id")) as any[];
  return c.json({ channel: { ...ch, tags } });
});

api.post("/channels/:id/sync", async (c) => {
  const channelId = c.req.param("id");
  try {
    const result = await syncChannel(channelId);
    log.info("channel.sync_requested", { channelId, added: result.added });
    return c.json({ ok: true, added: result.added });
  } catch (e) {
    log.error("channel.sync_failed", { channelId, error: e instanceof Error ? e.message : String(e) });
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

// ---------- user playlists ----------

api.get("/playlists", (c) => {
  const videoId = c.req.query("video_id");
  const rows = db
    .prepare(
      `SELECT p.id, p.name, p.icon, p.sort_order, p.created_at,
              COUNT(pv.video_id) AS video_count
              ${videoId ? ", EXISTS(SELECT 1 FROM user_playlist_videos cpv WHERE cpv.playlist_id = p.id AND cpv.video_id = ?) AS has_video" : ""}
       FROM user_playlists p
       LEFT JOIN user_playlist_videos pv ON pv.playlist_id = p.id
       GROUP BY p.id
       ORDER BY p.sort_order ASC, p.name COLLATE NOCASE`
    )
    .all(...(videoId ? [videoId] : []));
  return c.json({ playlists: rows });
});

api.post("/playlists", async (c) => {
  const { name, icon = "ListMusic" } = await c.req.json();
  if (!name?.trim()) return c.json({ error: "name required" }, 400);
  const nextOrder = db.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS sort_order FROM user_playlists").get() as { sort_order: number };
  const row = db
    .prepare("INSERT INTO user_playlists (name, icon, sort_order) VALUES (?, ?, ?) RETURNING id, name, icon, sort_order, created_at")
    .get(name.trim(), String(icon || "ListMusic").trim() || "ListMusic", nextOrder.sort_order);
  return c.json({ playlist: row });
});

api.put("/playlists/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json();
  const current = db.prepare("SELECT * FROM user_playlists WHERE id = ?").get(id) as any;
  if (!current) return c.json({ error: "not found" }, 404);
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : current.name;
  const icon = typeof body.icon === "string" && body.icon.trim() ? body.icon.trim() : current.icon;
  const sortOrder = Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : current.sort_order;
  const row = db
    .prepare("UPDATE user_playlists SET name = ?, icon = ?, sort_order = ? WHERE id = ? RETURNING id, name, icon, sort_order, created_at")
    .get(name, icon, sortOrder, id);
  return c.json({ playlist: row });
});

api.delete("/playlists/:id", (c) => {
  db.prepare("DELETE FROM user_playlists WHERE id = ?").run(c.req.param("id"));
  return c.json({ ok: true });
});

api.get("/playlists/:id", (c) => {
  const id = Number(c.req.param("id"));
  const playlist = db
    .prepare(
      `SELECT p.id, p.name, p.icon, p.sort_order, p.created_at, COUNT(pv.video_id) AS video_count
       FROM user_playlists p
       LEFT JOIN user_playlist_videos pv ON pv.playlist_id = p.id
       WHERE p.id = ?
       GROUP BY p.id`
    )
    .get(id) as any;
  if (!playlist) return c.json({ error: "not found" }, 404);
  const rows = db
    .prepare(
      `${BASE_SELECT}
       JOIN user_playlist_videos upv ON upv.video_id = v.video_id
       WHERE upv.playlist_id = ?
       ORDER BY upv.added_at DESC`
    )
    .all(id) as VideoRow[];
  return c.json({ playlist, videos: attachTags(rows) });
});

api.post("/playlists/:id/videos", async (c) => {
  const { video_id } = await c.req.json();
  if (!video_id) return c.json({ error: "video_id required" }, 400);
  db.prepare("INSERT OR IGNORE INTO user_playlist_videos (playlist_id, video_id) VALUES (?, ?)").run(c.req.param("id"), video_id);
  return c.json({ ok: true });
});

api.delete("/playlists/:id/videos/:videoId", (c) => {
  db.prepare("DELETE FROM user_playlist_videos WHERE playlist_id = ? AND video_id = ?").run(
    c.req.param("id"),
    c.req.param("videoId")
  );
  return c.json({ ok: true });
});

api.get("/playlists/:id/rules", (c) => {
  const rules = db.prepare("SELECT * FROM user_playlist_rules WHERE playlist_id = ? ORDER BY id").all(c.req.param("id"));
  return c.json({ rules });
});

api.post("/playlists/:id/rules", async (c) => {
  const { pattern, match_type = "contains", field = "title" } = await c.req.json();
  if (!pattern?.trim()) return c.json({ error: "pattern required" }, 400);
  if (!["contains", "regex"].includes(match_type)) return c.json({ error: "invalid match_type" }, 400);
  if (!["title", "description", "both"].includes(field)) return c.json({ error: "invalid field" }, 400);
  const row = db
    .prepare("INSERT INTO user_playlist_rules (playlist_id, pattern, match_type, field) VALUES (?, ?, ?, ?) RETURNING *")
    .get(c.req.param("id"), pattern.trim(), match_type, field) as any;
  const matched = applyPlaylistRuleToAllVideos(row.id);
  return c.json({ rule: row, matched });
});

api.delete("/playlists/:id/rules/:ruleId", (c) => {
  db.prepare("DELETE FROM user_playlist_rules WHERE playlist_id = ? AND id = ?").run(c.req.param("id"), c.req.param("ruleId"));
  return c.json({ ok: true });
});

api.post("/playlists/:id/rules/apply", (c) => {
  const matched = applyPlaylistRulesForPlaylist(Number(c.req.param("id")));
  return c.json({ ok: true, matched });
});

api.get("/playlists/:id/videos", async (c) => {
  try {
    const id = c.req.param("id");
    // Import all playlist videos into the owning channel (deduped) on load,
    // then return them for the player. Both calls share a cached feed fetch.
    const videos = await fetchPlaylistVideos(id);
    importPlaylistVideos(id).catch((e) => log.error("playlist.import.failed", { playlistId: id, error: e instanceof Error ? e.message : String(e) }));
    return c.json({ videos });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

api.post("/channels/import", async (c) => {
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) return c.json({ error: "file required" }, 400);
  const content = await file.text();
  const entries = content.trimStart().startsWith("<")
    ? parseOpml(content)
    : parseTakeoutCsv(content);
  const insert = db.prepare(
    "INSERT OR IGNORE INTO channels (channel_id, title, url) VALUES (?, ?, ?)"
  );
  let added = 0;
  for (const e of entries) {
    const r = insert.run(e.channelId, e.title, `https://www.youtube.com/channel/${e.channelId}`);
    if (r.changes > 0) added++;
  }
  log.info("channels.imported", { fileName: file.name, found: entries.length, added });
  refreshAll().catch((e) => log.error("channels.import_refresh_failed", { error: e instanceof Error ? e.message : String(e) }));
  return c.json({ ok: true, found: entries.length, added });
});

// ---------- tags ----------

api.get("/tags", (c) => {
  const tags = db
    .prepare(
      `SELECT t.*,
        (SELECT COUNT(*) FROM video_tags vt WHERE vt.tag_id = t.id) AS video_count,
        (SELECT COUNT(*) FROM channel_tags ct WHERE ct.tag_id = t.id) AS channel_count
       FROM tags t ORDER BY t.name COLLATE NOCASE`
    )
    .all();
  return c.json({ tags });
});

api.post("/tags", async (c) => {
  const { name, color } = await c.req.json();
  if (!name?.trim()) return c.json({ error: "name required" }, 400);
  const r = db
    .prepare("INSERT INTO tags (name, color) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET color = excluded.color RETURNING *")
    .get(name.trim(), color ?? "#7c5cff");
  return c.json({ tag: r });
});

api.patch("/tags/:id", async (c) => {
  const { name, color, filter_only } = await c.req.json();
  const id = c.req.param("id");
  if (name !== undefined) db.prepare("UPDATE tags SET name = ? WHERE id = ?").run(name.trim(), id);
  if (color !== undefined) db.prepare("UPDATE tags SET color = ? WHERE id = ?").run(color, id);
  if (filter_only !== undefined) db.prepare("UPDATE tags SET filter_only = ? WHERE id = ?").run(filter_only ? 1 : 0, id);
  const tag = db.prepare("SELECT * FROM tags WHERE id = ?").get(id);
  return c.json({ tag });
});

api.delete("/tags/:id", (c) => {
  db.prepare("DELETE FROM tags WHERE id = ?").run(c.req.param("id"));
  return c.json({ ok: true });
});

// ---------- auto-tag rules ----------

api.get("/rules", (c) => {
  const rules = db
    .prepare(
      `SELECT r.*, t.name AS tag_name, t.color AS tag_color FROM auto_tag_rules r JOIN tags t ON t.id = r.tag_id ORDER BY r.id`
    )
    .all();
  return c.json({ rules });
});

api.post("/rules", async (c) => {
  const { tag_id, pattern, match_type = "contains", field = "title" } = await c.req.json();
  if (!tag_id || !pattern?.trim()) return c.json({ error: "tag_id and pattern required" }, 400);
  const r = db
    .prepare("INSERT INTO auto_tag_rules (tag_id, pattern, match_type, field) VALUES (?, ?, ?, ?) RETURNING *")
    .get(tag_id, pattern.trim(), match_type, field) as any;
  const matched = applyRuleToAllVideos(r.id);
  return c.json({ rule: r, matched });
});

api.patch("/rules/:id", async (c) => {
  const { tag_id, pattern, match_type, field } = await c.req.json();
  const id = c.req.param("id");
  if (tag_id !== undefined) db.prepare("UPDATE auto_tag_rules SET tag_id = ? WHERE id = ?").run(tag_id, id);
  if (pattern !== undefined) db.prepare("UPDATE auto_tag_rules SET pattern = ? WHERE id = ?").run(pattern.trim(), id);
  if (match_type !== undefined) db.prepare("UPDATE auto_tag_rules SET match_type = ? WHERE id = ?").run(match_type, id);
  if (field !== undefined) db.prepare("UPDATE auto_tag_rules SET field = ? WHERE id = ?").run(field, id);
  const rule = db.prepare("SELECT r.*, t.name AS tag_name, t.color AS tag_color FROM auto_tag_rules r JOIN tags t ON t.id = r.tag_id WHERE r.id = ?").get(id);
  return c.json({ rule });
});

api.delete("/rules/:id", (c) => {
  db.prepare("DELETE FROM auto_tag_rules WHERE id = ?").run(c.req.param("id"));
  return c.json({ ok: true });
});

// ---------- filter rules ----------

api.get("/filter-rules", (c) => {
  const rules = db.prepare(
    `SELECT fr.*, c.title AS channel_title FROM filter_rules fr
     LEFT JOIN channels c ON c.channel_id = fr.channel_id ORDER BY fr.id`
  ).all();
  return c.json({ rules });
});

api.post("/filter-rules", async (c) => {
  const { pattern, match_type = "contains", field = "title", action = "reject", channel_id = null } = await c.req.json();
  if (!pattern?.trim()) return c.json({ error: "pattern required" }, 400);
  const row = db
    .prepare("INSERT INTO filter_rules (pattern, match_type, field, action, channel_id) VALUES (?, ?, ?, ?, ?) RETURNING *")
    .get(pattern.trim(), match_type, field, action, channel_id || null) as any;
  const archived = applyFilterRuleToAll(row.id);
  return c.json({ rule: row, archived });
});

api.patch("/filter-rules/:id", async (c) => {
  const { pattern, match_type, field, action, channel_id } = await c.req.json();
  const id = c.req.param("id");
  if (pattern !== undefined) db.prepare("UPDATE filter_rules SET pattern = ? WHERE id = ?").run(pattern.trim(), id);
  if (match_type !== undefined) db.prepare("UPDATE filter_rules SET match_type = ? WHERE id = ?").run(match_type, id);
  if (field !== undefined) db.prepare("UPDATE filter_rules SET field = ? WHERE id = ?").run(field, id);
  if (action !== undefined) db.prepare("UPDATE filter_rules SET action = ? WHERE id = ?").run(action, id);
  if (channel_id !== undefined) db.prepare("UPDATE filter_rules SET channel_id = ? WHERE id = ?").run(channel_id || null, id);
  const rule = db.prepare("SELECT fr.*, c.title AS channel_title FROM filter_rules fr LEFT JOIN channels c ON c.channel_id = fr.channel_id WHERE fr.id = ?").get(id);
  return c.json({ rule });
});

api.delete("/filter-rules/:id", (c) => {
  db.prepare("DELETE FROM filter_rules WHERE id = ?").run(c.req.param("id"));
  return c.json({ ok: true });
});

// ---------- image cache / proxy ----------

api.get("/img", async (c) => {
  const url = c.req.query("u");
  if (!url) return c.json({ error: "u required" }, 400);
  const img = await getCachedImage(url);
  // Nothing cached and origin failed: redirect so the browser can try directly.
  if (!img) return c.redirect(url, 302);
  return new Response(Bun.file(img.path), {
    headers: {
      "Content-Type": img.contentType,
      "Cache-Control": "public, max-age=86400",
    },
  });
});

// ---------- settings ----------

api.get("/child-lock", (c) => {
  return c.json({ child_lock: childLockStatus(c) });
});

api.post("/child-lock/enable", async (c) => {
  if (isChildLockEnabled()) return c.json({ error: "child lock already enabled" }, 409);
  const body = await c.req.json().catch(() => ({}));
  if (!isSixDigitPin(body.pin)) return c.json({ error: "PIN must have 6 digits" }, 400);
  setSetting("child_lock_pin_hash", await hashChildLockPin(body.pin));
  setSetting("child_lock_enabled", "1");
  setChildLockSession(c);
  return c.json({ child_lock: { enabled: true, locked: false } });
});

api.post("/child-lock/unlock", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (!isChildLockEnabled()) return c.json({ child_lock: childLockStatus(c) });
  if (!isSixDigitPin(body.pin) || !(await verifyChildLockPin(body.pin))) {
    return c.json({ error: "invalid PIN" }, 401);
  }
  setChildLockSession(c);
  return c.json({ child_lock: { enabled: true, locked: false } });
});

api.post("/child-lock/lock", (c) => {
  clearChildLockSession(c);
  return c.json({ child_lock: childLockStatus(c) });
});

api.post("/child-lock/change-pin", async (c) => {
  if (!isChildLockEnabled()) return c.json({ error: "child lock is disabled" }, 400);
  const body = await c.req.json().catch(() => ({}));
  const canChange = hasChildLockSession(c) || (isSixDigitPin(body.current_pin) && (await verifyChildLockPin(body.current_pin)));
  if (!canChange) return c.json({ error: "invalid PIN" }, 401);
  if (!isSixDigitPin(body.new_pin)) return c.json({ error: "PIN must have 6 digits" }, 400);
  setSetting("child_lock_pin_hash", await hashChildLockPin(body.new_pin));
  setChildLockSession(c);
  return c.json({ child_lock: { enabled: true, locked: false } });
});

api.post("/child-lock/disable", async (c) => {
  if (!isChildLockEnabled()) return c.json({ child_lock: childLockStatus(c) });
  const body = await c.req.json().catch(() => ({}));
  const canDisable = hasChildLockSession(c) || (isSixDigitPin(body.pin) && (await verifyChildLockPin(body.pin)));
  if (!canDisable) return c.json({ error: "invalid PIN" }, 401);
  setSetting("child_lock_enabled", "0");
  setSetting("child_lock_pin_hash", "");
  clearChildLockSession(c);
  return c.json({ child_lock: childLockStatus(c) });
});

api.get("/settings", (c) => {
  const settings: Record<string, string> = {};
  for (const key of Object.keys(SETTING_DEFAULTS)) {
    if (key === "child_lock_pin_hash") continue;
    settings[key] = getSetting(key) ?? SETTING_DEFAULTS[key];
  }
  return c.json({ settings });
});

api.put("/settings", async (c) => {
  const body = await c.req.json();
  for (const key of Object.keys(SETTING_DEFAULTS)) {
    if (key === "child_lock_pin_hash" || key === "child_lock_enabled") continue;
    if (key in body) setSetting(key, String(body[key]));
  }
  return c.json({ ok: true });
});

// ---------- refresh ----------

api.post("/refresh", async (c) => {
  const result = await refreshAll();
  log.info("refresh.manual_requested", { channels: result.channels, added: result.added, errors: result.errors.length });
  return c.json(result);
});

api.get("/logs", (c) => {
  const limit = Math.min(1000, Math.max(1, Number(c.req.query("limit") ?? 300)));
  return c.json(readRecentLogs(limit));
});
