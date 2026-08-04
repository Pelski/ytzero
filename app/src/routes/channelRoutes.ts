import type { Context, Hono } from "hono";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { publishAppEvent } from "../appEvents";
import { database } from "../database";
import { getSetting, getUserSetting } from "../db";
import { type ChannelAbout, fetchChannelAbout, fetchChannelFeed, fetchChannelPlaylists, fetchChannelSubscriberCountFromWatch, fetchChannelVideosDurations, resolveChannelId } from "../youtube";
import { preserveChannelMedia, preservePlaylistMedia } from "../channelMedia";
import { channelRefreshDiagnostics, refreshChannel, refreshLiveStatus, syncChannelMissingMetadata, syncChannelPlaylists } from "../refresher";
import { log } from "../logger";
import { isValidTimeZone } from "../timeZone";
import { computeShowFrom, SCHEDULE_BUCKETS } from "../scheduleTime";
import { refreshDiscoveryInBackground } from "../plugins";
import { cancelAutoDownloadIfUnwanted } from "../downloader";
import { childHidesLive, isChildUser } from "../childTime";
import { CHANNEL_PLAYLIST_CACHE_VERSION, saveChannelPlaylists } from "../channelPlaylists";
import { isChannelManualStatus } from "../channelStatus";
import { SUBTITLE_LANGUAGE_CODES } from "../subtitleLanguages";
import { videoSelect, type VideoRow } from "../videoRoutesSupport";
import { ABOUT_DB_TTL, ageMs, PLAYLISTS_DB_TTL } from "../routeCache";
import { registerChannelSyncRoutes, registerSingleChannelSyncRoute } from "./channelSyncRoutes";
import { registerChannelPostRoutes } from "./channelPostRoutes";
type ApiEnvironment = { Variables: { userId: number; sessionAdmin?: boolean; profileAdmin?: boolean } };
type Api = Hono<ApiEnvironment>;
type ApiContext = Context<ApiEnvironment>;

const anyChannelStmt = database.prepare("SELECT 1 FROM channels LIMIT 1");
const anyVideoStmt = database.prepare("SELECT 1 FROM videos LIMIT 1");
async function instanceHasData(): Promise<boolean> {
  return !!await anyChannelStmt.get() || !!await anyVideoStmt.get();
}

export async function playlistChannelSyncIsDisabled(playlistId: string): Promise<boolean> {
  const row = await database.prepare("SELECT c.manual_status FROM channel_playlists cp JOIN channels c ON c.channel_id=cp.channel_id WHERE cp.playlist_id=?").get(playlistId) as { manual_status: string } | null;
  return Boolean(row && row.manual_status !== "active");
}

export function registerChannelRoutes(
  api: Api,
  access: {
    currentUserId: (context: ApiContext) => number;
    isAdmin: (context: ApiContext) => boolean;
    hasChildLockSession: (context: ApiContext) => boolean;
    attachTags: (userId: number, videos: VideoRow[]) => Promise<Array<VideoRow & Record<string, unknown>>>;
    attachWatchedState: typeof import("../videoRoutesSupport").attachWatchedState;
  },
): void {
  const { currentUserId, isAdmin, hasChildLockSession, attachTags, attachWatchedState } = access;

// ---------- channels ----------

// The effective display name is the user-set custom title when present; the
// original YouTube title stays in `title` (exposed as original_title) so the
// custom name can always be reverted.
function serializeChannel(ch: any) {
  return {
    ...ch,
    title: ch.custom_title || ch.title,
    original_title: ch.title,
    custom_title: ch.custom_title ?? null,
  };
}

async function channelSyncIsDisabled(channelId: string): Promise<boolean> {
  const row = await database.prepare("SELECT manual_status FROM channels WHERE channel_id=?").get(channelId) as { manual_status: string } | null;
  return Boolean(row && row.manual_status !== "active");
}

api.get("/channels", async (c) => {
  const uid = currentUserId(c);
  const channels = await database.prepare(
    `SELECT ch.*, uc.added_at AS subscribed_at,
       (SELECT MAX(v.published_at) FROM videos v WHERE v.channel_id = ch.channel_id) AS latest_video_at,
       (SELECT COUNT(*) FROM videos v WHERE v.channel_id = ch.channel_id) AS video_count
     FROM channels ch
     JOIN user_channels uc ON uc.channel_id = ch.channel_id AND uc.user_id = ? AND uc.followed = 1
     WHERE ch.external = 0 ORDER BY COALESCE(ch.custom_title, ch.title) COLLATE NOCASE`
  ).all(uid) as any[];
  const tags = await database
    .prepare(
      `SELECT ct.channel_id, t.id, t.name, t.color FROM channel_tags ct JOIN tags t ON t.id = ct.tag_id AND t.user_id = ?`
    )
    .all(uid) as any[];
  return c.json({
    channels: channels.map((ch) => ({
      ...serializeChannel(ch),
      // This endpoint only returns subscriptions of the active profile. Do not
      // leak the legacy global channels.followed value into profile UI state.
      followed: 1,
      ...(() => {
        try {
          const about = JSON.parse(ch.about_json ?? "{}") as { handle?: unknown; description?: unknown };
          return {
            handle: typeof about.handle === "string" ? about.handle : "",
            description: typeof about.description === "string" ? about.description : "",
          };
        } catch {
          return { handle: "", description: "" };
        }
      })(),
      tags: tags.filter((t) => t.channel_id === ch.channel_id).map((t) => ({ id: t.id, name: t.name, color: t.color })),
    })),
    // Distinguishes a genuinely fresh install (show the full onboarding) from a
    // profile that simply isn't following anything yet on an instance that
    // already has channels/videos from another profile or an import.
    instance_has_data: await instanceHasData(),
  });
});

api.post("/channels", async (c) => {
  // A child may subscribe only after a parent unlocked settings for this browser.
  if (await isChildUser(currentUserId(c)) && !hasChildLockSession(c)) return c.json({ error: "settings locked" }, 423);
  const uid = currentUserId(c);
  const { url, custom_name } = await c.req.json();
  if (!url) return c.json({ error: "url required" }, 400);
  const info = await resolveChannelId(url);
  const inserted = await database.prepare(
    "INSERT OR IGNORE INTO channels (channel_id, title, url, thumbnail) VALUES (?, ?, ?, ?)"
  ).run(info.channelId, info.title, `https://www.youtube.com/channel/${info.channelId}`, info.thumbnail);
  // Subscribe the active profile (and unmark external if it was an orphan).
  await database.prepare(
    `INSERT INTO user_channels (user_id, channel_id, followed) VALUES (?, ?, 1)
     ON CONFLICT(user_id, channel_id) DO UPDATE SET followed = 1`
  ).run(uid, info.channelId);
  await database.prepare("UPDATE channels SET external = 0 WHERE channel_id = ?").run(info.channelId);
  const customTitle = typeof custom_name === "string" ? custom_name.trim() : "";
  if (customTitle) await database.prepare("UPDATE channels SET custom_title = ? WHERE channel_id = ?").run(customTitle, info.channelId);
  log.info("channel.added", { channelId: info.channelId, title: info.title, inserted: inserted.changes > 0, userId: uid });
  refreshChannel(info.channelId)
    .then(() => refreshLiveStatus(info.channelId))
    .catch((e) => log.error("channel.initial_refresh_failed", { channelId: info.channelId, error: e instanceof Error ? e.message : String(e) }));
  return c.json({ ok: true, channel_id: info.channelId, title: info.title });
});

// Admin: claim every existing channel for a profile. Intended for setups that
// had channels configured before auth, so ownership can be assigned explicitly
// instead of relying on "first user wins". Existing subscriptions are preserved.
api.post("/channels/assign-all", async (c) => {
  if (!isAdmin(c)) return c.json({ error: "admin only" }, 403);
  const { user_id } = await c.req.json().catch(() => ({}));
  const uid = Number(user_id);
  if (!Number.isInteger(uid) || !await database.prepare("SELECT 1 FROM users WHERE id = ?").get(uid)) {
    return c.json({ error: "profile not found" }, 404);
  }
  const res = await database.prepare(
    `INSERT OR IGNORE INTO user_channels (user_id, channel_id, followed)
     SELECT ?, channel_id, 1 FROM channels WHERE external = 0`
  ).run(uid);
  log.info("channels.assigned_all", { user_id: uid, added: res.changes });
  return c.json({ ok: true, added: res.changes });
});

// Unsubscribe the active profile. The channel/videos stay (other profiles may
// follow it; the refresher stops touching it once nobody does).
api.delete("/channels/:id", async (c) => {
  const uid = currentUserId(c);
  await database.prepare("DELETE FROM user_channels WHERE user_id = ? AND channel_id = ?").run(uid, c.req.param("id"));
  return c.json({ ok: true });
});

// Set or clear the channel's custom display name. Empty / null reverts to the
// original YouTube title (kept untouched in `title`).
api.put("/channels/:id/name", async (c) => {
  const channelId = c.req.param("id");
  if (!await database.prepare("SELECT 1 FROM channels WHERE channel_id = ?").get(channelId)) {
    return c.json({ error: "not found" }, 404);
  }
  const { custom_title } = await c.req.json().catch(() => ({}));
  const value = typeof custom_title === "string" && custom_title.trim() ? custom_title.trim() : null;
  await database.prepare("UPDATE channels SET custom_title = ? WHERE channel_id = ?").run(value, channelId);
  log.info("channel.renamed", { channelId, custom_title: value });
  const ch = await database.prepare("SELECT * FROM channels WHERE channel_id = ?").get(channelId) as any;
  return c.json({ ok: true, channel: serializeChannel(ch) });
});

api.put("/channels/:id/status", async (c) => {
  const channelId = c.req.param("id");
  const { status } = await c.req.json().catch(() => ({}));
  if (!isChannelManualStatus(status)) return c.json({ error: "invalid channel status" }, 400);
  const result = await database.prepare("UPDATE channels SET manual_status=?, manual_status_updated_at=datetime('now') WHERE channel_id=?").run(status, channelId);
  if (result.changes === 0) return c.json({ error: "not found" }, 404);
  log.info("channel.manual_status_changed", { channelId, status });
  return c.json({ ok: true, status });
});

api.post("/channels/:id/tags", async (c) => {
  const uid = currentUserId(c);
  const { tag_id } = await c.req.json();
  const channelId = c.req.param("id");
  if (!await database.prepare("SELECT 1 FROM tags WHERE id = ? AND user_id = ?").get(tag_id, uid)) {
    return c.json({ error: "tag not found" }, 404);
  }
  await database.prepare("INSERT OR IGNORE INTO channel_tags (channel_id, tag_id) VALUES (?, ?)").run(channelId, tag_id);
  // Propagate to all existing videos of this channel
  await database.prepare(
    "INSERT OR IGNORE INTO video_tags (video_id, tag_id, source) SELECT video_id, ?, 'channel' FROM videos WHERE channel_id = ?"
  ).run(tag_id, channelId);
  refreshDiscoveryInBackground(uid);
  return c.json({ ok: true });
});

api.delete("/channels/:id/tags/:tagId", async (c) => {
  const uid = currentUserId(c);
  const channelId = c.req.param("id");
  const tagId = c.req.param("tagId");
  await database.prepare("DELETE FROM channel_tags WHERE channel_id = ? AND tag_id = ?").run(channelId, tagId);
  // Remove channel-propagated tags from videos (keep manually added ones)
  await database.prepare(
    "DELETE FROM video_tags WHERE tag_id = ? AND source = 'channel' AND video_id IN (SELECT video_id FROM videos WHERE channel_id = ?)"
  ).run(tagId, channelId);
  refreshDiscoveryInBackground(uid);
  return c.json({ ok: true });
});

const ensureExternalChannelRow = database.prepare(`
  INSERT OR IGNORE INTO channels (channel_id, title, url, followed, external)
  VALUES (?, ?, ?, 0, 1)
`);

async function persistChannelAbout(channelId: string, about: ChannelAbout) {
  await ensureExternalChannelRow.run(channelId, about.title || channelId, `https://www.youtube.com/channel/${channelId}`);
  await database.prepare(
    `UPDATE channels SET about_json = ?, about_fetched_at = datetime('now'),
       thumbnail = COALESCE(?, thumbnail), title = COALESCE(?, title), subscriber_count = COALESCE(?, subscriber_count)
     WHERE channel_id = ?`
  ).run(JSON.stringify(about), about.avatar || null, about.title || null, about.subscriberCount || null, channelId);
}

function normalizeCachedChannelAbout(about: ChannelAbout): ChannelAbout {
  return {
    ...about,
    subscriberCount: about.subscriberCount ?? "",
  };
}

/** Fetch about from YouTube, persist it, and backfill video durations. */
async function refreshChannelAbout(channelId: string): Promise<ChannelAbout> {
  const about = await fetchChannelAbout(channelId);
  const watchSubscriber = about.subscriberCount ? null : await fetchChannelSubscriberCountFromWatch(channelId).catch(() => null);
  const aboutWithSubscriber = watchSubscriber?.subscriberCount
    ? { ...about, subscriberCount: watchSubscriber.subscriberCount }
    : about;
  const aboutForStorage = await preserveChannelMedia(channelId, aboutWithSubscriber);
  await persistChannelAbout(channelId, aboutForStorage);
  fetchChannelVideosDurations(channelId).then(async (durations) => {
    const upd = database.prepare("UPDATE videos SET duration = ? WHERE video_id = ? AND duration IS NULL");
    for (const d of durations) await upd.run(d.duration, d.videoId);
  }).catch((error) => {
    log.warn("channel.about_duration_backfill_failed", { channelId, error: error instanceof Error ? error.message : String(error) });
  });
  return aboutForStorage;
}

api.get("/channels/:id/about", async (c) => {
  const channelId = c.req.param("id");
  const syncDisabled = await channelSyncIsDisabled(channelId);
  // Real counts from our own data — stable regardless of how many pages the
  // UI has loaded (NULL is_short counts as a regular video, matching the UI).
  const row = await database.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN published_at IS NOT NULL AND published_at != '' AND COALESCE(is_short, 0) = 0 THEN 1 ELSE 0 END), 0) AS videos,
      COALESCE(SUM(CASE WHEN published_at IS NOT NULL AND published_at != '' AND is_short = 1 THEN 1 ELSE 0 END), 0) AS shorts,
      COALESCE(SUM(CASE WHEN published_at IS NULL OR published_at = '' THEN 1 ELSE 0 END), 0) AS processing
    FROM videos WHERE channel_id = ?
  `).get(channelId) as { videos: number; shorts: number; processing: number };
  const counts = row;
  // The channel page header shows the custom name too; the scraped about
  // payload keeps the original underneath.
  const customTitle = (await database.prepare("SELECT custom_title FROM channels WHERE channel_id = ?").get(channelId) as { custom_title: string | null } | null)?.custom_title ?? null;
  const withCustomTitle = <T extends { title: string }>(about: T): T =>
    customTitle ? { ...about, title: customTitle } : about;

  // Serve the cached about from the DB; only touch YouTube when it's missing
  // or stale (and then in the background, so the page never waits on it).
  const cachedRow = await database.prepare("SELECT about_json, about_fetched_at, subscriber_count FROM channels WHERE channel_id = ?")
    .get(channelId) as { about_json: string | null; about_fetched_at: string | null; subscriber_count: string | null } | null;

  if (cachedRow?.about_json) {
    if (!syncDisabled && ageMs(cachedRow.about_fetched_at) > ABOUT_DB_TTL) {
      refreshChannelAbout(channelId).catch((e) =>
        log.warn("channel.about.refresh_failed", { channelId, error: e instanceof Error ? e.message : String(e) }));
    }
    try {
      const cachedAbout = JSON.parse(cachedRow.about_json) as Partial<ChannelAbout>;
      if (!("subscriberCount" in cachedAbout) && !syncDisabled) {
        return c.json({ ...withCustomTitle(await refreshChannelAbout(channelId)), counts });
      }
      return c.json({ ...withCustomTitle(normalizeCachedChannelAbout(cachedAbout as ChannelAbout)), counts });
    } catch {
      // corrupted cache — fall through to a fresh fetch
    }
  }

  if (syncDisabled) {
    const ch = await database.prepare("SELECT title, thumbnail, subscriber_count FROM channels WHERE channel_id = ?")
      .get(channelId) as { title: string; thumbnail: string | null; subscriber_count: string | null } | null;
    if (!ch) return c.json({ error: "not found" }, 404);
    return c.json({ channelId, title: customTitle || ch.title || "", description: "", avatar: ch.thumbnail ?? "", banner: "", subscriberCount: ch.subscriber_count ?? "", stats: [], links: [], joinedDate: "", viewCount: "", handle: "", counts });
  }

  // No usable cache: fetch synchronously this once, then it's served from DB.
  try {
    return c.json({ ...withCustomTitle(await refreshChannelAbout(channelId)), counts });
  } catch (e) {
    // YouTube can rate-limit (429) or change layout — fall back to the basic
    // columns so the page still shows avatar/title/subs instead of breaking.
    const ch = await database.prepare("SELECT title, thumbnail, subscriber_count FROM channels WHERE channel_id = ?")
      .get(channelId) as { title: string; thumbnail: string | null; subscriber_count: string | null } | null;
    if (!ch) return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
    log.warn("channel.about.fallback", { channelId, error: e instanceof Error ? e.message : String(e) });
    return c.json({
      channelId,
      title: customTitle || ch.title || "",
      description: "",
      avatar: ch.thumbnail ?? "",
      banner: "",
      subscriberCount: ch.subscriber_count ?? "",
      stats: [],
      links: [],
      joinedDate: "",
      viewCount: "",
      handle: "",
      counts,
    });
  }
});

async function attachPlaylistFollowState(userId: number, playlists: any[]) {
  const followed = await database.prepare("SELECT playlist_id FROM user_followed_playlists WHERE user_id = ?").all(userId) as { playlist_id: string }[];
  const ids = new Set(followed.map((row) => row.playlist_id));
  return playlists.map((playlist) => ({ ...playlist, followed: ids.has(playlist.playlistId) }));
}

async function refreshChannelPlaylists(channelId: string, force = false) {
  const playlists = await preservePlaylistMedia(channelId, await fetchChannelPlaylists(channelId, force));
  // Channel pages are available for unsubscribed/external creators too. Their
  // parent row may not exist yet, but channel_playlists has a strict FK.
  await ensureExternalChannelRow.run(channelId, channelId, `https://www.youtube.com/channel/${channelId}`);
  await saveChannelPlaylists(channelId, playlists);
  await database.prepare("UPDATE channels SET playlists_json = ?, playlists_fetched_at = datetime('now'), playlists_cache_version = ? WHERE channel_id = ?")
    .run(JSON.stringify(playlists), CHANNEL_PLAYLIST_CACHE_VERSION, channelId);
  return playlists;
}

api.get("/channels/:id/playlists", async (c) => {
  const uid = currentUserId(c);
  const channelId = c.req.param("id");
  const syncDisabled = await channelSyncIsDisabled(channelId);
  const cached = await database.prepare("SELECT playlists_json, playlists_fetched_at, playlists_cache_version FROM channels WHERE channel_id = ?")
    .get(channelId) as { playlists_json: string | null; playlists_fetched_at: string | null; playlists_cache_version: number } | null;

  if (cached?.playlists_json) {
    try {
      const playlists = JSON.parse(cached.playlists_json);
      if (!syncDisabled && cached.playlists_cache_version < CHANNEL_PLAYLIST_CACHE_VERSION) {
        return c.json({ playlists: await attachPlaylistFollowState(uid, await refreshChannelPlaylists(channelId, true)) });
      }
      // Pre-pagination cache entries commonly contain exactly YouTube's first
      // page of 30 cards. Upgrade them synchronously so this request already
      // shows the missing playlists instead of waiting for the weekly refresh.
      if (!syncDisabled && Array.isArray(playlists) && playlists.length === 30) {
        return c.json({ playlists: await attachPlaylistFollowState(uid, await refreshChannelPlaylists(channelId)) });
      }
      if (Array.isArray(playlists)) await saveChannelPlaylists(channelId, playlists);
    } catch { /* corrupted cache — fall through to a fresh fetch */ }
    if (!syncDisabled && ageMs(cached.playlists_fetched_at) > PLAYLISTS_DB_TTL) {
      refreshChannelPlaylists(channelId).catch((e) =>
        log.warn("channel.playlists.refresh_failed", { channelId, error: e instanceof Error ? e.message : String(e) }));
    }
    try {
      return c.json({ playlists: await attachPlaylistFollowState(uid, JSON.parse(cached.playlists_json)) });
    } catch { /* corrupted cache — fall through */ }
  }

  if (syncDisabled) return c.json({ playlists: [] });

  try {
    return c.json({ playlists: await attachPlaylistFollowState(uid, await refreshChannelPlaylists(channelId)) });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

api.post("/channels/:id/playlists/sync", async (c) => {
  const channelId = c.req.param("id");
  if (await channelSyncIsDisabled(channelId)) return c.json({ error: "channel sync disabled" }, 409);
  try {
    const result = await syncChannelPlaylists(channelId);
    log.info("channel.playlists.sync_requested", { channelId, count: result.playlists.length, synced: result.synced, added: result.added, errors: result.errors });
    return c.json({
      ok: true,
      count: result.playlists.length,
      synced: result.synced,
      added: result.added,
      errors: result.errors,
      playlists: await attachPlaylistFollowState(currentUserId(c), result.playlists),
    });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

api.post("/channels/:id/metadata/sync", async (c) => {
  const channelId = c.req.param("id");
  if (await channelSyncIsDisabled(channelId)) return c.json({ error: "channel sync disabled" }, 409);
  try {
    return c.json({ ok: true, ...(await syncChannelMissingMetadata(channelId)) });
  } catch (e) {
    log.error("channel.metadata_sync_failed", { channelId, error: e instanceof Error ? e.message : String(e) });
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

api.put("/channels/:id/follow", async (c) => {
  const uid = currentUserId(c);
  const { followed } = await c.req.json<{ followed: boolean }>();
  const channelId = c.req.param("id");
  const existing = await database.prepare("SELECT 1 FROM channels WHERE channel_id = ?").get(channelId);

  // A channel reached through YouTube search may not have any local videos yet,
  // so it has no `channels` row. Create that parent row before writing the
  // profile subscription relation; otherwise SQLite correctly rejects the FK.
  if (followed && !existing) {
    try {
      const info = await resolveChannelId(channelId);
      if (info.channelId !== channelId) return c.json({ error: "channel id mismatch" }, 400);
      await database.prepare(
        "INSERT OR IGNORE INTO channels (channel_id, title, url, thumbnail) VALUES (?, ?, ?, ?)"
      ).run(channelId, info.title, `https://www.youtube.com/channel/${channelId}`, info.thumbnail);
      refreshChannel(channelId)
        .then(() => refreshLiveStatus(channelId))
        .catch((error) => log.error("channel.initial_refresh_failed", { channelId, error: error instanceof Error ? error.message : String(error) }));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 502);
    }
  }

  // Unfollowing a channel that has since disappeared locally is already the
  // desired state, and avoids inserting a relation with no parent channel.
  if (!followed && !existing) return c.json({ ok: true });
  await database.prepare(
    `INSERT INTO user_channels (user_id, channel_id, followed) VALUES (?, ?, ?)
     ON CONFLICT(user_id, channel_id) DO UPDATE SET followed = excluded.followed`
  ).run(uid, channelId, followed ? 1 : 0);
  if (followed) await database.prepare("UPDATE channels SET external = 0 WHERE channel_id = ?").run(channelId);
  return c.json({ ok: true });
});

// Per-channel playback speed override for the active profile. Empty/"default"
// clears it (stored as NULL) so the video falls back to the global player_speed.
api.put("/channels/:id/speed", async (c) => {
  const uid = currentUserId(c);
  const { speed } = await c.req.json<{ speed: string | null }>();
  const value = !speed || speed === "default" ? null : speed;
  await database.prepare(
    `INSERT INTO user_channels (user_id, channel_id, playback_speed) VALUES (?, ?, ?)
     ON CONFLICT(user_id, channel_id) DO UPDATE SET playback_speed = excluded.playback_speed`
  ).run(uid, c.req.param("id"), value);
  return c.json({ ok: true });
});

// Per-profile caption override. A channel can inherit the profile default,
// explicitly disable captions, or force one YouTube caption language.
api.put("/channels/:id/captions", async (c) => {
  const { mode, language } = await c.req.json<{ mode: unknown; language?: unknown }>();
  if (mode !== null && mode !== "off" && mode !== "language") {
    return c.json({ error: "mode must be null, off, or language" }, 400);
  }
  const captionLanguage = mode === "language" && typeof language === "string" && SUBTITLE_LANGUAGE_CODES.has(language)
    ? language
    : null;
  if (mode === "language" && !captionLanguage) return c.json({ error: "valid caption language required" }, 400);
  await database.prepare(
    `INSERT INTO user_channels (user_id, channel_id, caption_mode, caption_language) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, channel_id) DO UPDATE SET caption_mode = excluded.caption_mode, caption_language = excluded.caption_language`
  ).run(currentUserId(c), c.req.param("id"), mode, captionLanguage);
  return c.json({ ok: true, mode, language: captionLanguage });
});

// Per-profile visibility of a channel's members-only uploads. The default
// inherits the profile-wide main-feed preference and keeps the channel page
// visible; every explicit mode owns both surfaces.
api.put("/channels/:id/members-only-feed", async (c) => {
  const { visibility } = await c.req.json<{ visibility: unknown }>();
  if (visibility !== "default" && visibility !== "everywhere" && visibility !== "channel" && visibility !== "hidden") {
    return c.json({ error: "visibility must be default, everywhere, channel, or hidden" }, 400);
  }
  const values = {
    default: [null, 0],
    everywhere: [0, 0],
    channel: [1, 0],
    hidden: [1, 1],
  } as const;
  const [hideFromFeed, hideOnChannel] = values[visibility];
  await database.prepare(
    `INSERT INTO user_channels (user_id, channel_id, hide_members_only_from_feed, hide_members_only_on_channel, members_only_visibility) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, channel_id) DO UPDATE SET hide_members_only_from_feed = excluded.hide_members_only_from_feed, hide_members_only_on_channel = excluded.hide_members_only_on_channel, members_only_visibility = excluded.members_only_visibility`
  ).run(currentUserId(c), c.req.param("id"), hideFromFeed, hideOnChannel, visibility);
  return c.json({ ok: true, visibility });
});

// Per-profile opt-in for the selective Shorts mode. Strict global "none" and
// "all" modes ignore this value but keep it so switching modes is reversible.
api.put("/channels/:id/shorts-feed", async (c) => {
  const { visibility } = await c.req.json<{ visibility: unknown }>();
  if (visibility !== "default" && visibility !== "show") {
    return c.json({ error: "visibility must be default or show" }, 400);
  }
  await database.prepare(
    `INSERT INTO user_channels (user_id, channel_id, followed, shorts_feed_visibility) VALUES (?, ?, 0, ?)
     ON CONFLICT(user_id, channel_id) DO UPDATE SET shorts_feed_visibility = excluded.shorts_feed_visibility`
  ).run(currentUserId(c), c.req.param("id"), visibility);
  return c.json({ ok: true, visibility });
});

// Downloads are shared between profiles, therefore this is intentionally a
// channel-level setting rather than a user_channels preference. Zero disables
// the threshold.
api.put("/channels/:id/download-min-duration", async (c) => {
  const { seconds } = await c.req.json<{ seconds: unknown }>();
  if (seconds !== null && (!Number.isInteger(seconds) || (seconds as number) < 0 || (seconds as number) > 24 * 60 * 60)) {
    return c.json({ error: "seconds must be null or an integer between 0 and 86400" }, 400);
  }
  const value = seconds === null ? null : seconds as number;
  const result = await database.prepare("UPDATE channels SET auto_download_min_duration_override = ? WHERE channel_id = ?")
    .run(value, c.req.param("id"));
  if (result.changes === 0) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true, seconds: value });
});

// Literal paths before parameterised /channels/:id to avoid shadowing
api.get("/channels/unfollowed", async (c) => {
  const uid = currentUserId(c);
  const channels = await database.prepare(
    `SELECT ch.* FROM channels ch
     JOIN user_channels uc ON uc.channel_id = ch.channel_id AND uc.user_id = ? AND uc.followed = 0
     WHERE ch.external = 0 ORDER BY COALESCE(ch.custom_title, ch.title) COLLATE NOCASE`
  ).all(uid) as any[];
  const tags = await database.prepare(
    `SELECT ct.channel_id, t.id, t.name, t.color
     FROM channel_tags ct JOIN tags t ON t.id = ct.tag_id AND t.user_id = ?`
  ).all(uid) as any[];
  return c.json({
    channels: channels.map((channel) => ({
      ...serializeChannel(channel),
      followed: 0,
      tags: tags.filter((tag) => tag.channel_id === channel.channel_id)
        .map((tag) => ({ id: tag.id, name: tag.name, color: tag.color })),
    })),
  });
});

api.get("/channels/top", async (c) => {
  const uid = currentUserId(c);
  const rows = await database.prepare(`
    SELECT c.channel_id, COALESCE(c.custom_title, c.title) AS title, c.thumbnail, c.subscriber_count,
           COUNT(h.id) AS watch_count,
           CASE WHEN EXISTS(
             SELECT 1 FROM videos v WHERE v.channel_id = c.channel_id AND v.live_status = 'live'
           ) THEN 1 ELSE 0 END AS is_live
    FROM channels c
    JOIN user_channels uc ON uc.channel_id = c.channel_id AND uc.user_id = ${uid} AND uc.followed = 1
    JOIN videos vv ON vv.channel_id = c.channel_id
    JOIN history h ON h.video_id = vv.video_id AND h.user_id = ${uid}
    WHERE c.external = 0
    GROUP BY c.channel_id, c.custom_title, c.title, c.thumbnail, c.subscriber_count
    ORDER BY is_live DESC, watch_count DESC
    LIMIT 30
  `).all() as any[];
  return c.json({ channels: rows });
});

api.get("/channels/recent", async (c) => {
  const uid = currentUserId(c);
  // Sidebar ordering is navigation, not the main feed. Keep it stable by using
  // the latest regular upload regardless of the Shorts feed policy.
  const shortsFilter = "AND COALESCE(is_short, 0) = 0";
  const rows = await database.prepare(`
    SELECT c.channel_id, COALESCE(c.custom_title, c.title) AS title, c.thumbnail,
           (SELECT thumbnail FROM videos WHERE channel_id = c.channel_id ${shortsFilter} ORDER BY COALESCE(published_at, created_at) DESC LIMIT 1) AS latest_thumbnail,
           (SELECT video_id FROM videos WHERE channel_id = c.channel_id ${shortsFilter} ORDER BY COALESCE(published_at, created_at) DESC LIMIT 1) AS latest_video_id
    FROM channels c
    JOIN user_channels uc ON uc.channel_id = c.channel_id AND uc.user_id = ? AND uc.followed = 1
    ORDER BY COALESCE(
      (SELECT published_at FROM videos WHERE channel_id = c.channel_id ${shortsFilter} ORDER BY COALESCE(published_at, created_at) DESC LIMIT 1),
      '1970-01-01'
    ) DESC
    LIMIT 20
  `).all(uid) as any[];
  return c.json({ channels: await attachWatchedState(uid, rows, (row) => row.latest_video_id) });
});

registerChannelSyncRoutes(api, currentUserId); registerChannelPostRoutes(api, currentUserId, attachTags);

api.get("/channels/:id", async (c) => {
  const uid = currentUserId(c);
  const ch = await database.prepare("SELECT * FROM channels WHERE channel_id = ?").get(c.req.param("id")) as any;
  if (!ch) return c.json({ error: "not found" }, 404);
  const tags = await database
    .prepare(
      `SELECT t.id, t.name, t.color FROM channel_tags ct JOIN tags t ON t.id = ct.tag_id AND t.user_id = ? WHERE ct.channel_id = ?`
    )
    .all(uid, c.req.param("id")) as any[];
  // followed reflects the active profile (null row = not subscribed).
  const sub = await database.prepare("SELECT followed, playback_speed, caption_mode, caption_language, hide_members_only_from_feed, hide_members_only_on_channel, members_only_visibility, shorts_feed_visibility FROM user_channels WHERE user_id = ? AND channel_id = ?").get(uid, c.req.param("id")) as { followed: number; playback_speed: string | null; caption_mode: string | null; caption_language: string | null; hide_members_only_from_feed: number | null; hide_members_only_on_channel: number | null; members_only_visibility: string | null; shorts_feed_visibility: string | null } | null;
  return c.json({ channel: { ...serializeChannel(ch), followed: sub ? sub.followed : 0, playback_speed: sub?.playback_speed ?? null, caption_mode: sub?.caption_mode ?? null, caption_language: sub?.caption_language ?? null, hide_members_only_from_feed: sub?.hide_members_only_from_feed ?? null, hide_members_only_on_channel: sub?.hide_members_only_on_channel ?? null, members_only_visibility: sub?.members_only_visibility === "feed" ? "everywhere" : sub?.members_only_visibility ?? "default", shorts_feed_visibility: sub?.shorts_feed_visibility === "show" ? "show" : "default", posts_enabled: getUserSetting(uid, "channel_posts_tab") === "1", tags } });
});

api.get("/channels/:id/refresh-schedule", async (c) => {
  const details = await channelRefreshDiagnostics(c.req.param("id"));
  return details ? c.json(details) : c.json({ error: "not found" }, 404);
});

api.put("/channels/:id/refresh-schedule", async (c) => {
  const body = await c.req.json<{ mode?: unknown; days?: unknown; times?: unknown; time?: unknown }>();
  if (body.mode !== "adaptive" && body.mode !== "manual") return c.json({ error: "mode must be adaptive or manual" }, 400);
  if (body.mode === "adaptive") {
    const result = await database.prepare("UPDATE channels SET refresh_schedule_days = NULL, refresh_schedule_time = NULL WHERE channel_id = ?").run(c.req.param("id"));
    if (result.changes === 0) return c.json({ error: "not found" }, 404);
  } else {
    const days = Array.isArray(body.days) ? [...new Set(body.days)] : [];
    const validDays = days.length > 0 && days.every((day) => Number.isInteger(day) && Number(day) >= 0 && Number(day) <= 6);
    const requestedTimes = Array.isArray(body.times) ? body.times : typeof body.time === "string" ? [body.time] : [];
    const times = [...new Set(requestedTimes)].filter((time): time is string => typeof time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(time)).sort();
    const validTimes = requestedTimes.length > 0 && requestedTimes.every((time) => typeof time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(time));
    if (!validDays || !validTimes) return c.json({ error: "manual schedule requires weekdays and one or more HH:mm times" }, 400);
    const result = await database.prepare("UPDATE channels SET refresh_schedule_days = ?, refresh_schedule_time = ? WHERE channel_id = ?")
      .run(JSON.stringify(days.map(Number).sort()), JSON.stringify(times), c.req.param("id"));
    if (result.changes === 0) return c.json({ error: "not found" }, 404);
  }
  log.info("channel.refresh_schedule_updated", { channelId: c.req.param("id"), mode: body.mode });
  return c.json(await channelRefreshDiagnostics(c.req.param("id"))!);
});

registerSingleChannelSyncRoute(api, currentUserId);

}
