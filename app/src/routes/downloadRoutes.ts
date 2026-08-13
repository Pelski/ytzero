import type { Context, Hono } from "hono";
import { existsSync, statSync } from "node:fs";
import { publishAppEvent } from "../appEvents";
import { database } from "../database";
import { getUserSetting } from "../db";
import { childLocalOnly, isChildUser } from "../childTime";
import { DOWNLOADS_ADMIN_SETTING_KEYS, downloadCookiesConfigured, downloadSettings, profileDownloadsEnabled, removeDownloadCookies, saveDownloadCookies, setDownloadSettings, setProfileDownloadsEnabled } from "../downloadConfig";
import { activeDownloadProgress, cancelAllPendingDownloads, downloadStats, downloadStatusSummary, enqueueDownload, fetchSubtitles, getDownload, getHlsPlaylist, getHlsSegment, invalidateAudioSources, listDownloads, listSubtitleFiles, liveStreamEnabled, prioritizeDownload, removeDownload, setDownloadPinned, srtToVtt, ytdlpJavascriptRuntimeStatus, ytdlpStatus } from "../downloader";
import { createDownloadRule, deleteDownloadRule, DownloadRuleValidationError, listDownloadRules, previewDownloadRule, updateDownloadRule, type DownloadRuleInput } from "../downloadRules";
import { SUBTITLE_LANGUAGE_CODES } from "../subtitleLanguages";
import { configuredTimeZone } from "../timeZone";
import { tubeArchivistResource, tubeArchivistSubtitleList, tubeArchivistSubtitleResponse } from "../tubeArchivist";
import { registerAudioRoutes } from "./audioRoutes";

type ApiEnvironment = { Variables: { userId: number; sessionAdmin?: boolean; profileAdmin?: boolean } };
type Api = Hono<ApiEnvironment>;
type ApiContext = Context<ApiEnvironment>;

const videoExistsStmt = database.prepare("SELECT 1 FROM videos WHERE video_id = ?");

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
  return c.json({ can_manage: true, can_manage_admin_settings: isAdmin(c), admin_setting_keys: [...DOWNLOADS_ADMIN_SETTING_KEYS], enabled, ...settings, cookies_configured: downloadCookiesConfigured(uid), time_zone: configuredTimeZone() });
});

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
  return await isChildUser(uid) ? c.json({ error: "not allowed" }, 403) : c.json({ configured: downloadCookiesConfigured(uid) });
});

api.post("/downloads/cookies", async (c) => {
  const uid = currentUserId(c);
  if (await isChildUser(uid)) return c.json({ error: "not allowed" }, 403);
  try {
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return c.json({ error: "cookies.txt file required" }, 400);
    saveDownloadCookies(uid, await file.text());
    invalidateAudioSources(uid);
    return c.json({ configured: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

api.delete("/downloads/cookies", async (c) => {
  const uid = currentUserId(c);
  if (await isChildUser(uid)) return c.json({ error: "not allowed" }, 403);
  removeDownloadCookies(uid);
  invalidateAudioSources(uid);
  return c.json({ configured: false });
});

api.get("/downloads", async (c) => {
  const uid = currentUserId(c);
  const includeAllProfiles = c.req.query("scope") === "all" && isAdmin(c);
  const downloads = await listDownloads(uid, includeAllProfiles);
  const progress = activeDownloadProgress();
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
  const video = await database.prepare("SELECT live_status, is_private FROM videos WHERE video_id = ?").get(id) as { live_status: string; is_private: number } | null;
  if (!video) return c.json({ error: "not found" }, 404);
  if (video.is_private === 1) return c.json({ error: "private videos cannot be downloaded" }, 409);
  if (video.live_status === "live" || video.live_status === "upcoming") {
    return c.json({ error: "live streams cannot be downloaded while they are active" }, 409);
  }
  const body = await c.req.json().catch(() => ({} as { priority?: boolean }));
  if (body.priority) await prioritizeDownload(uid, id);
  else await enqueueDownload(uid, id, "manual");
  return c.json({ ok: true, download: await getDownload(uid, id) });
});

// Download state for one video, with live progress while it's the active job.
api.get("/videos/:id/download", async (c) => {
  const id = c.req.param("id");
  const download = await getDownload(currentUserId(c), id);
  const progress = activeDownloadProgress();
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
  const size = statSync(row.path).size;
  const contentType = row.path.endsWith(".webm") ? "video/webm" : "video/mp4";
  const file = Bun.file(row.path);
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

// EXPERIMENTAL: play + seek a not-yet-downloaded video via on-demand HLS. The
// playlist is a static VOD for the whole (known) duration, so the browser can
// seek anywhere; each segment is transcoded on demand from the direct stream.
// A clean copy is saved in the background so /stream serves it locally later.
//   GET .../hls/index.m3u8  -> the static VOD playlist
//   GET .../hls/segNNNNN.ts -> a media segment (produced on demand)
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
    const playlist = await getHlsPlaylist(uid, id);
    if (!playlist) return c.json({ error: "stream unavailable" }, 502);
    return new Response(playlist, {
      headers: { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" },
    });
  }

  if (!await getDownload(uid, id)) return c.json({ error: "not found" }, 404);
  const path = await getHlsSegment(id, file, c.req.raw.signal);
  if (!path) return c.json({ error: "not found" }, 404);
  return new Response(Bun.file(path), {
    headers: { "Content-Type": "video/mp2t", "Cache-Control": "no-store" },
  });
});

registerAudioRoutes(api, currentUserId);

// ---------- subtitles for the local player ----------

async function subtitleList(videoId: string) {
  return (await listSubtitleFiles(videoId)).map((s) => ({
    lang: s.lang,
    url: `/api/videos/${videoId}/subtitles/${encodeURIComponent(s.lang)}`,
  }));
}

api.get("/videos/:id/subtitles", async (c) => {
  if (!await getDownload(currentUserId(c), c.req.param("id"))) {
    return c.json({ subtitles: await tubeArchivistSubtitleList(c.req.param("id")) ?? [] });
  }
  return c.json({ subtitles: await subtitleList(c.req.param("id")) });
});

api.get("/videos/:id/subtitles/:lang", async (c) => {
  if (!await getDownload(currentUserId(c), c.req.param("id"))) {
    return await tubeArchivistSubtitleResponse(c.req.param("id"), c.req.param("lang"), c.req.raw.signal)
      ?? c.json({ error: "not found" }, 404);
  }
  const file = (await listSubtitleFiles(c.req.param("id"))).find((s) => s.lang === c.req.param("lang"));
  if (!file || !existsSync(file.path)) return c.json({ error: "not found" }, 404);
  let text = await Bun.file(file.path).text();
  if (file.ext === "srt") text = srtToVtt(text);
  return new Response(text, {
    headers: { "Content-Type": "text/vtt; charset=utf-8", "Cache-Control": "no-store" },
  });
});

// Viewer picked a language that wasn't downloaded with the video: fetch just
// the subtitles (no video re-download) and hand back the refreshed list.
api.post("/videos/:id/subtitles", async (c) => {
  const uid = currentUserId(c);
  if (childLocalOnly(uid)) return c.json({ error: "restricted" }, 403);
  if (!await profileDownloadsEnabled(uid)) return c.json({ error: "downloads disabled" }, 409);
  const id = c.req.param("id");
  if (!await getDownload(uid, id)) return c.json({ error: "not downloaded" }, 404);
  const { lang } = await c.req.json().catch(() => ({}));
  if (typeof lang !== "string" || !SUBTITLE_LANGUAGE_CODES.has(lang)) {
    return c.json({ error: "invalid language" }, 400);
  }
  if (!await videoExistsStmt.get(id)) return c.json({ error: "not found" }, 404);
  const ok = await fetchSubtitles(uid, id, lang);
  const subtitles = await subtitleList(id);
  return c.json({ ok, downloaded: subtitles.some((s) => s.lang === lang), subtitles });
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
