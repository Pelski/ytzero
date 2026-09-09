import type { Context, Hono } from "hono";
import { existsSync, statSync } from "node:fs";
import { publishAppEvent } from "../appEvents";
import { database } from "../database";
import { getUserSetting } from "../db";
import { childLocalOnly, isChildUser } from "../childTime";
import { DOWNLOADS_ADMIN_SETTING_KEYS, dlSettings, downloadCookiesConfigured, downloadSettings, profileDownloadsEnabled, removeDownloadCookies, saveDownloadCookies, setDownloadSettings, setProfileDownloadsEnabled } from "../downloadConfig";
import { activeDownloadProgress, cancelAllPendingDownloads, downloadStats, downloadStatusSummary, enqueueDownload, ensureMobilePlayback, getDirectVideoResponse, getDownload, getHlsPlaylist, getHlsResource, getHlsSegment, hasHlsSession, invalidateAudioSources, invalidateDirectVideoSources, isSegmentName, listDownloads, listSubtitleFiles, liveStreamEnabled, prioritizeDownload, removeDownload, setDownloadPinned, srtToVtt, ytdlpJavascriptRuntimeStatus, ytdlpStatus } from "../downloader";
import { createDownloadRule, deleteDownloadRule, DownloadRuleValidationError, listDownloadRules, previewDownloadRule, updateDownloadRule, type DownloadRuleInput } from "../downloadRules";
import { availableSubtitlesForVideo, normalizeSubtitleLanguage, subtitleStreamForVideo } from "../subtitleAvailability";
import { subtitleLanguageLabel } from "../subtitleLanguages";
import { fetchSubtitleUpstream, proxySubtitleResponse } from "../subtitleUpstream";
import { configuredTimeZone } from "../timeZone";
import { tubeArchivistResource, tubeArchivistSubtitleList, tubeArchivistSubtitleResponse } from "../tubeArchivist";
import { validYouTubeVideoId } from "../youtubeComments";
import { registerAudioRoutes } from "./audioRoutes";
import { registerYtdlpUpdateRoutes } from "./ytdlpUpdateRoutes";
import { ytdlpUpdateChannel, ytdlpUpdateIntervalDays } from "../ytdlpUpdater";
import { ensureOnDemandVideo, OnDemandVideoImportError } from "../onDemandVideoImport";
import type { DownloadQuality } from "../downloadSettings";
import { invalidateYouTubeCookieHealth, youtubeCookieHealth } from "../youtubeCookieJar";

type ApiEnvironment = { Variables: { userId: number; sessionAdmin?: boolean; profileAdmin?: boolean } };
type Api = Hono<ApiEnvironment>;
type ApiContext = Context<ApiEnvironment>;

const videoExistsStmt = database.prepare("SELECT 1 FROM videos WHERE video_id = ?");

async function playlistDownloadContext(userId: number, videoId: string, value: unknown): Promise<{ playlistTitle?: string; downloadQuality?: DownloadQuality | null }> {
  if (!value || typeof value !== "object") return {};
  const context = value as Record<string, unknown>;
  if (context.kind === "user-playlist" && typeof context.playlistUuid === "string") {
    const playlist = await database.prepare(`
      SELECT playlist.name, playlist.download_quality
      FROM user_playlists playlist
      JOIN user_playlist_videos membership ON membership.playlist_id=playlist.id
      WHERE playlist.user_id=? AND playlist.portable_uuid=? AND membership.video_id=?
    `).get(userId, context.playlistUuid, videoId) as { name: string; download_quality: DownloadQuality | null } | null;
    return playlist ? { playlistTitle: playlist.name, downloadQuality: playlist.download_quality } : {};
  }
  if (context.kind === "channel-playlist" && typeof context.playlistId === "string") {
    const playlist = await database.prepare(`
      SELECT catalog.title, followed.download_quality
      FROM user_followed_playlists followed
      JOIN channel_playlists catalog ON catalog.playlist_id=followed.playlist_id
      JOIN channel_playlist_videos membership ON membership.playlist_id=followed.playlist_id
      WHERE followed.user_id=? AND followed.playlist_id=? AND membership.video_id=?
    `).get(userId, context.playlistId, videoId) as { title: string; download_quality: DownloadQuality | null } | null;
    return playlist ? { playlistTitle: playlist.title, downloadQuality: playlist.download_quality } : {};
  }
  return {};
}

export function registerDownloadRoutes(
  api: Api,
  access: {
    currentUserId: (context: ApiContext) => number;
    isAdmin: (context: ApiContext) => boolean;
  },
): void {
  const { currentUserId, isAdmin } = access;

// ---------- downloads configuration ----------

api.get("/downloads/config", async (c) => {
  const uid = currentUserId(c);
  return c.json({
    can_manage: !await isChildUser(uid),
    can_manage_admin_settings: isAdmin(c),
    admin_setting_keys: [...DOWNLOADS_ADMIN_SETTING_KEYS],
    enabled: await profileDownloadsEnabled(uid),
    ...(await downloadSettings(uid, getUserSetting(uid, "language"))),
    cookies_configured: downloadCookiesConfigured(uid),
    time_zone: configuredTimeZone(),
    ytdlp: { version: await ytdlpStatus(), update_channel: ytdlpUpdateChannel(), update_interval_days: ytdlpUpdateIntervalDays() },
  });
});

api.put("/downloads/config", async (c) => {
  const uid = currentUserId(c);
  if (await isChildUser(uid)) return c.json({ error: "not allowed" }, 403);
  const body = await c.req.json<{ enabled?: boolean; settings?: Record<string, unknown> }>();
  if (typeof body.enabled === "boolean") {
    await setProfileDownloadsEnabled(uid, body.enabled);
  }
  if (!isAdmin(c) && body.settings && Object.keys(body.settings).some((key) => DOWNLOADS_ADMIN_SETTING_KEYS.has(key))) {
    return c.json({ error: "administrator setting" }, 403);
  }
  const settings = body.settings && typeof body.settings === "object"
    ? await setDownloadSettings(uid, body.settings, getUserSetting(uid, "language"))
    : await downloadSettings(uid, getUserSetting(uid, "language"));
  const enabled = await profileDownloadsEnabled(uid);
  publishAppEvent("downloads", { enabled, config: true, userId: uid });
  return c.json({ can_manage: true, can_manage_admin_settings: isAdmin(c), admin_setting_keys: [...DOWNLOADS_ADMIN_SETTING_KEYS], enabled, ...settings, cookies_configured: downloadCookiesConfigured(uid), time_zone: configuredTimeZone(), ytdlp: { version: await ytdlpStatus(), update_channel: ytdlpUpdateChannel(), update_interval_days: ytdlpUpdateIntervalDays() } });
});

registerYtdlpUpdateRoutes(api, isAdmin);

api.get("/downloads/automation", async (c) => {
  const uid = currentUserId(c);
  return c.json({ rules: await listDownloadRules(uid), can_manage: !await isChildUser(uid) });
});

api.get("/downloads/automation/options", async (c) => {
  const uid = currentUserId(c);
  const channels = await database.prepare(`
    SELECT DISTINCT c.channel_id, COALESCE(NULLIF(c.custom_title, ''), c.title) AS title, c.thumbnail
    FROM user_channels uc JOIN channels c ON c.channel_id=uc.channel_id
    WHERE uc.user_id=? AND uc.followed=1 ORDER BY title COLLATE NOCASE
  `).all(uid);
  const playlists = await database.prepare(`
    SELECT DISTINCT cp.playlist_id, cp.title, cp.thumbnail,
           COALESCE(NULLIF(c.custom_title, ''), c.title) AS channel_title
    FROM channel_playlists cp
    JOIN channels c ON c.channel_id=cp.channel_id
    WHERE EXISTS (SELECT 1 FROM user_followed_playlists ufp WHERE ufp.user_id=? AND ufp.playlist_id=cp.playlist_id)
       OR EXISTS (SELECT 1 FROM user_channels uc WHERE uc.user_id=? AND uc.channel_id=cp.channel_id AND uc.followed=1)
    ORDER BY channel_title COLLATE NOCASE, cp.title COLLATE NOCASE
  `).all(uid, uid);
  return c.json({ channels, playlists });
});

api.post("/downloads/automation/preview", async (c) => {
  const uid = currentUserId(c);
  if (await isChildUser(uid)) return c.json({ error: "not allowed" }, 403);
  return c.json(await previewDownloadRule(uid, await c.req.json<Partial<DownloadRuleInput>>()));
});

api.post("/downloads/automation", async (c) => {
  const uid = currentUserId(c);
  if (await isChildUser(uid)) return c.json({ error: "not allowed" }, 403);
  try {
    const rule = await createDownloadRule(uid, await c.req.json<Partial<DownloadRuleInput>>());
    publishAppEvent("downloads", { automation: true, ruleId: rule.id });
    return c.json({ rule }, 201);
  } catch (error) {
    if (error instanceof DownloadRuleValidationError) return c.json({ error: error.message }, 400);
    throw error;
  }
});

api.put("/downloads/automation/:id", async (c) => {
  const uid = currentUserId(c);
  if (await isChildUser(uid)) return c.json({ error: "not allowed" }, 403);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid rule id" }, 400);
  try {
    const rule = await updateDownloadRule(uid, id, await c.req.json<Partial<DownloadRuleInput>>());
    if (!rule) return c.json({ error: "not found" }, 404);
    publishAppEvent("downloads", { automation: true, ruleId: rule.id });
    return c.json({ rule });
  } catch (error) {
    if (error instanceof DownloadRuleValidationError) return c.json({ error: error.message }, 400);
    throw error;
  }
});

api.delete("/downloads/automation/:id", async (c) => {
  const uid = currentUserId(c);
  if (await isChildUser(uid)) return c.json({ error: "not allowed" }, 403);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid rule id" }, 400);
  if (!await deleteDownloadRule(uid, id)) return c.json({ error: "not found" }, 404);
  publishAppEvent("downloads", { automation: true, ruleId: id });
  return c.json({ ok: true });
});

api.get("/downloads/cookies", async (c) => {
  const uid = currentUserId(c);
  return await isChildUser(uid) ? c.json({ error: "not allowed" }, 403) : c.json(await youtubeCookieHealth(uid));
});

api.post("/downloads/cookies", async (c) => {
  const uid = currentUserId(c);
  if (await isChildUser(uid)) return c.json({ error: "not allowed" }, 403);
  try {
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return c.json({ error: "cookies.txt file required" }, 400);
    saveDownloadCookies(uid, await file.text());
    invalidateYouTubeCookieHealth(uid);
    invalidateAudioSources(uid);
    invalidateDirectVideoSources(uid);
    return c.json(await youtubeCookieHealth(uid));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

api.delete("/downloads/cookies", async (c) => {
  const uid = currentUserId(c);
  if (await isChildUser(uid)) return c.json({ error: "not allowed" }, 403);
  removeDownloadCookies(uid);
  invalidateYouTubeCookieHealth(uid);
  invalidateAudioSources(uid);
  invalidateDirectVideoSources(uid);
  return c.json({ configured: false, recognition: "unknown" as const, checked_at: null });
});

api.get("/downloads", async (c) => {
  const uid = currentUserId(c);
  const includeAllProfiles = c.req.query("scope") === "all" && isAdmin(c);
  const downloads = await listDownloads(uid, includeAllProfiles);
  const progress = await activeDownloadProgress();
  const ytdlpVersion = await ytdlpStatus();
  return c.json({
    enabled: await profileDownloadsEnabled(uid),
    can_view_all: isAdmin(c),
    scope: includeAllProfiles ? "all" : "mine",
    ytdlp_version: ytdlpVersion,
    ytdlp_js_runtime_version: ytdlpVersion ? await ytdlpJavascriptRuntimeStatus() : null,
    stats: await downloadStats(uid, includeAllProfiles),
    active: progress && downloads.some((item) => item.video_id === progress.video_id) ? progress : null,
    downloads,
  });
});

api.get("/downloads/summary", async (c) => {
  const uid = currentUserId(c);
  return c.json({ enabled: await profileDownloadsEnabled(uid), ...await downloadStatusSummary(uid) });
});

api.delete("/downloads/queue", async (c) => {
  if (await isChildUser(currentUserId(c))) return c.json({ error: "not allowed" }, 403);
  return c.json({ ok: true, cancelled: await cancelAllPendingDownloads(currentUserId(c)) });
});

api.post("/videos/:id/download", async (c) => {
  if (await isChildUser(currentUserId(c))) return c.json({ error: "not allowed" }, 403);
  const uid = currentUserId(c);
  if (!await profileDownloadsEnabled(uid)) return c.json({ error: "downloads disabled" }, 409);
  const id = c.req.param("id");
  try {
    await ensureOnDemandVideo(id, uid);
  } catch (error) {
    if (error instanceof OnDemandVideoImportError) return c.json({ error: error.message }, error.status);
    throw error;
  }
  const video = await database.prepare("SELECT live_status, is_private FROM videos WHERE video_id = ?").get(id) as { live_status: string; is_private: number } | null;
  if (!video) return c.json({ error: "not found" }, 404);
  if (video.is_private === 1) return c.json({ error: "private videos cannot be downloaded" }, 409);
  if (video.live_status === "live" || video.live_status === "upcoming") {
    return c.json({ error: "live streams cannot be downloaded while they are active" }, 409);
  }
  const body = await c.req.json().catch(() => ({})) as { priority?: boolean; keep?: boolean; playlist_context?: unknown };
  if (body.priority) await prioritizeDownload(uid, id);
  else await enqueueDownload(uid, id, "manual", false, false, await playlistDownloadContext(uid, id, body.playlist_context));
  if (body.keep) await setDownloadPinned(uid, id, true);
  return c.json({ ok: true, download: await getDownload(uid, id) });
});

// Download state for one video, with live progress while it's the active job.
api.get("/videos/:id/download", async (c) => {
  const id = c.req.param("id");
  const download = await getDownload(currentUserId(c), id);
  const progress = await activeDownloadProgress();
  return c.json({
    download,
    progress: download?.status === "downloading" && progress?.video_id === id ? progress : null,
  });
});

api.delete("/videos/:id/download", async (c) => {
  const uid = currentUserId(c);
  if (await isChildUser(uid)) return c.json({ error: "not allowed" }, 403);
  const requestedProfile = Number(c.req.query("profile_id"));
  const ownerId = Number.isInteger(requestedProfile) && requestedProfile > 0 && isAdmin(c) ? requestedProfile : uid;
  await removeDownload(ownerId, c.req.param("id"));
  return c.json({ ok: true });
});

api.put("/videos/:id/download/pin", async (c) => {
  const uid = currentUserId(c);
  if (await isChildUser(uid)) return c.json({ error: "not allowed" }, 403);
  const { pinned } = await c.req.json() as { pinned?: boolean };
  const requestedProfile = Number(c.req.query("profile_id"));
  const ownerId = Number.isInteger(requestedProfile) && requestedProfile > 0 && isAdmin(c) ? requestedProfile : uid;
  await setDownloadPinned(ownerId, c.req.param("id"), !!pinned);
  return c.json({ ok: true, download: await getDownload(ownerId, c.req.param("id")) });
});

// Serves the downloaded file to the <video> element. Range support is what
// makes seeking work, so it's handled explicitly.
api.get("/videos/:id/stream", async (c) => {
  const row = await getDownload(currentUserId(c), c.req.param("id"));
  if (!row || row.status !== "done" || !row.path || !existsSync(row.path)) {
    const archived = await tubeArchivistResource(c.req.param("id"), "media", c.req.header("range"), c.req.raw.signal);
    return archived ?? c.json({ error: "not downloaded" }, 404);
  }
  let streamPath = row.path;
  const userAgent = c.req.header("user-agent") ?? "";
  const compatibilityRequested = c.req.query("compat") === "1" || /iPhone|iPad|iPod/i.test(userAgent);
  if (compatibilityRequested) {
    const mobile = await ensureMobilePlayback(row.path);
    if (mobile) streamPath = mobile.path;
  }
  const size = statSync(streamPath).size;
  const contentType = streamPath.endsWith(".webm") ? "video/webm" : "video/mp4";
  const file = Bun.file(streamPath);
  const range = c.req.header("range");
  if (range) {
    const m = range.match(/bytes=(\d*)-(\d*)/);
    let start = m?.[1] ? Number(m[1]) : 0;
    let end = m?.[2] ? Number(m[2]) : size - 1;
    if (!Number.isFinite(start) || start >= size) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    end = Math.min(end, size - 1);
    return new Response(file.slice(start, end + 1), {
      status: 206,
      headers: {
        "Content-Type": contentType,
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(end - start + 1),
      },
    });
  }
  return new Response(file, {
    headers: { "Content-Type": contentType, "Accept-Ranges": "bytes", "Content-Length": String(size) },
  });
});

async function directStreamVideo(id: string) {
  return await database.prepare("SELECT live_status, members_only FROM videos WHERE video_id = ?").get(id) as { live_status: string; members_only: number } | null;
}

async function directStreamResponse(c: ApiContext) {
  const uid = currentUserId(c);
  if (await isChildUser(uid)) return c.json({ error: "not allowed" }, 403);
  const id = c.req.param("id");
  if (!id) return c.json({ error: "not found" }, 404);
  const video = await directStreamVideo(id);
  if (!video) return c.json({ error: "not found" }, 404);
  if (video.members_only === 1 || video.live_status === "live" || video.live_status === "upcoming") {
    return c.json({ error: "direct stream unavailable" }, 409);
  }
  if (!await ytdlpStatus()) return c.json({ error: "yt-dlp unavailable" }, 503);
  const response = await getDirectVideoResponse(uid, id, c.req.header("range") ?? null, c.req.raw.signal);
  return response ?? c.json({ error: "direct stream unavailable" }, 502);
}

api.get("/videos/:id/direct-stream", directStreamResponse);

// EXPERIMENTAL: play a not-yet-downloaded video through a validated fMP4 HLS
// presentation. Unsupported source indexes fall back to on-demand ffmpeg TS
// segments; either path still saves a normal download in the background.
api.get("/videos/:id/hls/:file", async (c) => {
  const uid = currentUserId(c);
  if (await isChildUser(uid)) return c.json({ error: "not allowed" }, 403);
  if (!await liveStreamEnabled(uid)) return c.json({ error: "streaming disabled" }, 409);
  const id = c.req.param("id");
  const file = c.req.param("file");

  if (file === "index.m3u8") {
    const done = await getDownload(uid, id);
    if (done && done.status === "done" && done.path && existsSync(done.path)) {
      return c.json({ error: "already downloaded" }, 409);
    }
    if (!await videoExistsStmt.get(id)) return c.json({ error: "not found" }, 404);
    const playlist = await getHlsPlaylist(uid, id, c.req.raw.signal);
    if (!playlist) return c.json({ error: "stream unavailable" }, 502);
    return new Response(playlist, {
      headers: { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" },
    });
  }

  if (!await getDownload(uid, id) && !hasHlsSession(uid, id)) return c.json({ error: "not found" }, 404);
  if (!isSegmentName(file)) {
    const resource = await getHlsResource(
      uid,
      id,
      file,
      c.req.header("range") ?? null,
      c.req.query("v") ?? null,
      c.req.raw.signal,
    );
    if (resource.kind === "response") return resource.response;
    if (resource.kind === "stale") return c.json({ error: "stream changed; reload the playlist" }, 410);
    if (resource.kind === "failed") return c.json({ error: "stream temporarily unavailable" }, 502);
    return c.json({ error: "not found" }, 404);
  }
  const path = await getHlsSegment(uid, id, file, c.req.raw.signal);
  if (!path) return c.json({ error: "not found" }, 404);
  return new Response(Bun.file(path), {
    headers: { "Content-Type": "video/mp2t", "Cache-Control": "no-store" },
  });
});

registerAudioRoutes(api, currentUserId);

// ---------- subtitles for the local player ----------

async function subtitleList(videoId: string) {
  const grouped = new Map<string, { lang: string; url: string; label: string; raw: string }>();
  for (const subtitle of await listSubtitleFiles(videoId)) {
    const lang = normalizeSubtitleLanguage(subtitle.lang);
    const current = grouped.get(lang);
    // A literal language code is the most intuitive local default. Keep a
    // suffixed track only when it is the sole successful fallback on disk.
    if (current && (current.raw === lang || subtitle.lang !== lang)) continue;
    grouped.set(lang, {
      lang,
      label: subtitleLanguageLabel(lang),
      raw: subtitle.lang,
      url: `/api/videos/${encodeURIComponent(videoId)}/subtitles/${encodeURIComponent(lang)}`,
    });
  }
  return [...grouped.values()].map(({ raw: _raw, ...subtitle }) => subtitle);
}

async function subtitlePreferences(userId: number, videoId: string): Promise<string[]> {
  const settings = await dlSettings(userId);
  const row = await database.prepare(`
    SELECT uc.caption_mode, uc.caption_language
    FROM videos v LEFT JOIN user_channels uc ON uc.channel_id=v.channel_id AND uc.user_id=?
    WHERE v.video_id=?
  `).get(userId, videoId) as { caption_mode: string | null; caption_language: string | null } | null;
  return [...new Set([
    getUserSetting(userId, "player_cc_lang"),
    getUserSetting(userId, "player_hl"),
    ...String(settings.sub_langs ?? "").split(",").map((language) => language.trim()),
    row?.caption_mode === "language" ? row.caption_language : null,
  ].filter((language): language is string => typeof language === "string" && language.length > 0))];
}

api.get("/videos/:id/subtitles", async (c) => {
  const uid = currentUserId(c);
  const videoId = c.req.param("id");
  if (!validYouTubeVideoId(videoId) || !await videoExistsStmt.get(videoId)) return c.json({ error: "not found" }, 404);
  const tubeArchivist = await tubeArchivistSubtitleList(videoId) ?? [];
  const local = await getDownload(uid, videoId) ? await subtitleList(videoId) : [];
  const subtitles = new Map<string, { lang: string; url: string; label?: string }>();
  for (const subtitle of tubeArchivist) subtitles.set(subtitle.lang, subtitle);
  for (const subtitle of local) if (!subtitles.has(subtitle.lang)) subtitles.set(subtitle.lang, subtitle);
  if (!childLocalOnly(uid)) try {
    const available = await availableSubtitlesForVideo(uid, videoId, await subtitlePreferences(uid, videoId));
    for (const subtitle of available) {
      if (!subtitles.has(subtitle.lang)) subtitles.set(subtitle.lang, {
        lang: subtitle.lang,
        label: subtitle.label,
        url: `/api/videos/${encodeURIComponent(videoId)}/subtitles/${encodeURIComponent(subtitle.lang)}`,
      });
    }
  } catch {
    // Local and TubeArchivist tracks remain usable when yt-dlp metadata fails.
  }
  const list = [...subtitles.values()].sort((a, b) => (a.label ?? subtitleLanguageLabel(a.lang)).localeCompare(b.label ?? subtitleLanguageLabel(b.lang)));
  return c.json({ subtitles: list, available: list.map(({ lang, label }) => ({ lang, label: label ?? subtitleLanguageLabel(lang) })) });
});

api.get("/videos/:id/subtitles/:lang", async (c) => {
  const uid = currentUserId(c);
  const videoId = c.req.param("id");
  const language = c.req.param("lang");
  if (!validYouTubeVideoId(videoId) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(language) || !await videoExistsStmt.get(videoId)) {
    return c.json({ error: "not found" }, 404);
  }
  const archived = await tubeArchivistSubtitleResponse(videoId, language, c.req.raw.signal);
  if (archived) return archived;
  if (await getDownload(uid, videoId)) {
    const file = (await listSubtitleFiles(videoId)).find((subtitle) => normalizeSubtitleLanguage(subtitle.lang) === language);
    if (file && existsSync(file.path)) {
      let text = await Bun.file(file.path).text();
      if (file.ext === "srt") text = srtToVtt(text);
      return new Response(text, { headers: { "Content-Type": "text/vtt; charset=utf-8", "Cache-Control": "no-store" } });
    }
  }
  if (childLocalOnly(uid)) return c.json({ error: "not found" }, 404);
  try {
    const url = await subtitleStreamForVideo(uid, videoId, language, await subtitlePreferences(uid, videoId));
    if (!url) return c.json({ error: "not found" }, 404);
    const upstream = await fetchSubtitleUpstream(fetch, url, { signal: c.req.raw.signal });
    const proxied = upstream && proxySubtitleResponse(upstream);
    if (!proxied) {
      await upstream?.body?.cancel().catch(() => {});
      return c.json({ error: "subtitle unavailable" }, 502);
    }
    return proxied;
  } catch {
    return c.json({ error: "subtitle unavailable" }, 502);
  }
});

// Download a locally saved video as a file rather than streaming it in the
// player. Kept separate from /stream so local playback retains range support.
api.get("/videos/:id/file", async (c) => {
  const row = await getDownload(currentUserId(c), c.req.param("id"));
  if (!row || row.status !== "done" || !row.path || !existsSync(row.path)) {
    return c.json({ error: "not downloaded" }, 404);
  }
  const title = (await database.prepare("SELECT title FROM videos WHERE video_id = ?").get(c.req.param("id")) as { title: string } | null)?.title
    ?? c.req.param("id");
  const extension = row.path.endsWith(".webm") ? "webm" : "mp4";
  const filename = `${title.replace(/[\\/:*?\"<>|]/g, "_")}.${extension}`;
  return new Response(Bun.file(row.path), {
    headers: {
      "Content-Type": extension === "webm" ? "video/webm" : "video/mp4",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
});

}
