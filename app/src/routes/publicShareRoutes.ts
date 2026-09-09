import { existsSync, statSync } from "node:fs";
import { Hono } from "hono";
import { database } from "../database";
import { getSetting } from "../db";
import { getDownload, listSubtitleFiles, srtToVtt } from "../downloader";
import { isAllowedRemoteImageUrl, isValidImagePayload } from "../imageCachePolicy";
import { log } from "../logger";
import { parseAudioRange } from "../audioRange";
import { pluginEnabled } from "../plugins";
import {
  PUBLIC_SHARE_PAGE_SIZE,
  PUBLIC_SHARE_TOKEN_PATTERN,
  publicShareChapters,
  publicShareContainsVideo,
  publicShareCreators,
  publicShareVideo,
  publicShareVideoIds,
  resolvePublicShare,
  type PublicShareRow,
  type PublicShareVideo,
} from "../publicSharing";
import { diagnosticRequestPath } from "../requestDiagnostics";
import { normalizeSubtitleLanguage } from "../subtitleAvailability";
import { subtitleLanguageLabel } from "../subtitleLanguages";
import {
  tubeArchivistConfigured,
  tubeArchivistResource,
  tubeArchivistSubtitleList,
  tubeArchivistSubtitleResponse,
} from "../tubeArchivist";

const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const RATE_PER_MINUTE = 120;
const RATE_BURST = 30;
const RATE_MAX_ENTRIES = 10_000;
const MEDIA_LIMIT = 4;

interface RateEntry { tokens: number; updatedAt: number }

export class PublicShareRateLimiter {
  private readonly entries = new Map<string, RateEntry>();

  constructor(private readonly now: () => number = Date.now) {}

  take(key: string): { allowed: boolean; retryAfter: number } {
    const now = this.now();
    const current = this.entries.get(key) ?? { tokens: RATE_BURST, updatedAt: now };
    const elapsed = Math.max(0, now - current.updatedAt);
    current.tokens = Math.min(RATE_BURST, current.tokens + elapsed * RATE_PER_MINUTE / 60_000);
    current.updatedAt = now;
    this.entries.delete(key);
    if (current.tokens >= 1) {
      current.tokens -= 1;
      this.entries.set(key, current);
      this.trim();
      return { allowed: true, retryAfter: 0 };
    }
    this.entries.set(key, current);
    this.trim();
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((1 - current.tokens) / (RATE_PER_MINUTE / 60_000) / 1_000)) };
  }

  private trim(): void {
    while (this.entries.size > RATE_MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}

export class PublicShareMediaLimiter {
  private readonly counts = new Map<string, number>();

  acquire(token: string): (() => void) | null {
    const active = this.counts.get(token) ?? 0;
    if (active >= MEDIA_LIMIT) return null;
    this.counts.set(token, active + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const remaining = (this.counts.get(token) ?? 1) - 1;
      if (remaining > 0) this.counts.set(token, remaining); else this.counts.delete(token);
    };
  }
}

function clientAddress(c: any): string {
  return c.req.header("cf-connecting-ip")?.trim()
    || c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
    || c.req.header("x-real-ip")?.trim()
    || "unknown";
}

function notFound(c: any) {
  return c.json({ error: "not found" }, 404);
}

function publicThumbnailUrl(token: string, videoId: string): string {
  return `/share/${encodeURIComponent(token)}/thumbnail/${encodeURIComponent(videoId)}`;
}

function publicVideoDto(token: string, video: PublicShareVideo) {
  const { chapters_json: _chapters, ...safe } = video;
  return { ...safe, thumbnail: publicThumbnailUrl(token, video.video_id) };
}

function publicCreatorDto(token: string, videoId: string, creator: Awaited<ReturnType<typeof publicShareCreators>>[number]) {
  const { thumbnail, ...safe } = creator;
  return {
    ...safe,
    avatar: thumbnail ? `/share/${encodeURIComponent(token)}/avatar/${encodeURIComponent(videoId)}/${encodeURIComponent(creator.channel_id)}` : "",
  };
}

function publicBrandColor(): string {
  const color = getSetting("app_icon_color") || "#0a5fff";
  return /^#[\da-f]{6}$/i.test(color) ? color : "#0a5fff";
}

async function authorizedVideo(token: string, videoId: string) {
  const resolved = await resolvePublicShare(token);
  if (!resolved || !await publicShareContainsVideo(resolved.share, videoId)) return null;
  const video = await publicShareVideo(videoId);
  return video ? { ...resolved, video } : null;
}

async function downloadedSource(share: PublicShareRow, videoId: string) {
  const row = await getDownload(share.owner_user_id, videoId);
  if (!row || row.status !== "done" || !row.path || !existsSync(row.path)) return null;
  try {
    return statSync(row.path).isFile() ? row : null;
  } catch {
    return null;
  }
}

async function tubeArchivistAvailable(videoId: string): Promise<boolean> {
  if (!pluginEnabled("tubearchivist") || !tubeArchivistConfigured()) return false;
  return Boolean(await database.prepare("SELECT 1 FROM tube_archivist_items WHERE video_id=? AND available=1").get(videoId));
}

async function localMediaSource(share: PublicShareRow, videoId: string): Promise<"download" | "tubearchivist" | null> {
  if (share.allow_local_media !== 1) return null;
  if (await downloadedSource(share, videoId)) return "download";
  return await tubeArchivistAvailable(videoId) ? "tubearchivist" : null;
}

async function subtitleCatalog(token: string, share: PublicShareRow, videoId: string) {
  if (share.allow_local_media !== 1) return { subtitles: [], available: [] };
  const subtitles = new Map<string, { lang: string; label: string; url: string }>();
  if (await downloadedSource(share, videoId)) {
    for (const subtitle of await listSubtitleFiles(videoId)) {
      const lang = normalizeSubtitleLanguage(subtitle.lang);
      if (!subtitles.has(lang)) subtitles.set(lang, {
        lang,
        label: subtitleLanguageLabel(lang),
        url: `/share/${encodeURIComponent(token)}/subtitles/${encodeURIComponent(videoId)}/${encodeURIComponent(lang)}`,
      });
    }
  }
  for (const subtitle of await tubeArchivistSubtitleList(videoId) ?? []) {
    if (!subtitles.has(subtitle.lang)) subtitles.set(subtitle.lang, {
      lang: subtitle.lang,
      label: subtitleLanguageLabel(subtitle.lang),
      url: `/share/${encodeURIComponent(token)}/subtitles/${encodeURIComponent(videoId)}/${encodeURIComponent(subtitle.lang)}`,
    });
  }
  const list = [...subtitles.values()].sort((left, right) => left.label.localeCompare(right.label));
  return { subtitles: list, available: list.map(({ lang, label }) => ({ lang, label })) };
}

function extractRemoteThumbnail(value: string): string | null {
  if (/^https:\/\//.test(value)) return isAllowedRemoteImageUrl(value) ? value : null;
  try {
    const parsed = new URL(value, "http://ytzero.local");
    if (parsed.pathname === "/api/img") {
      const remote = parsed.searchParams.get("u");
      return remote && isAllowedRemoteImageUrl(remote) ? remote : null;
    }
  } catch {}
  return null;
}

async function remoteImageResponse(url: string, signal: AbortSignal): Promise<Response | null> {
  let candidate = url;
  for (let redirects = 0; redirects < 2; redirects++) {
    const response = await fetch(candidate, { redirect: "manual", signal, headers: { Accept: "image/avif,image/webp,image/*" } }).catch(() => null);
    if (!response) return null;
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => {});
      if (!location) return null;
      const next = new URL(location, candidate).toString();
      if (!isAllowedRemoteImageUrl(next)) return null;
      candidate = next;
      continue;
    }
    if (!response.ok) { await response.body?.cancel().catch(() => {}); return null; }
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > IMAGE_MAX_BYTES) { await response.body?.cancel().catch(() => {}); return null; }
    const body = new Uint8Array(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") ?? "";
    if (body.byteLength > IMAGE_MAX_BYTES || !isValidImagePayload(contentType, body)) return null;
    return new Response(body, { headers: { "Content-Type": contentType, "Content-Length": String(body.byteLength) } });
  }
  return null;
}

async function localMediaResponse(path: string, rangeValue: string | null, head: boolean): Promise<Response> {
  const range = parseAudioRange(rangeValue);
  const size = statSync(path).size;
  if (!range || range.start >= size) {
    return new Response(null, { status: 416, headers: { "Accept-Ranges": "bytes", "Content-Range": `bytes */${size}` } });
  }
  const end = Math.min(range.end, size - 1);
  const length = end - range.start + 1;
  const contentType = path.toLowerCase().endsWith(".webm") ? "video/webm" : "video/mp4";
  const body = head ? null : await Bun.file(path).slice(range.start, end + 1).arrayBuffer();
  return new Response(body, { status: 206, headers: {
    "Content-Type": contentType,
    "Content-Range": `bytes ${range.start}-${end}/${size}`,
    "Accept-Ranges": "bytes",
    "Content-Length": String(length),
  } });
}

function responseWithLease(response: Response, release: () => void): Response {
  if (!response.body) {
    release();
    return response;
  }
  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          release();
          controller.close();
        } else {
          controller.enqueue(chunk.value);
        }
      } catch (error) {
        release();
        controller.error(error);
      }
    },
    async cancel(reason) {
      release();
      await reader.cancel(reason).catch(() => {});
    },
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

export function createPublicShareRouter(uiDir: string) {
  const router = new Hono();
  const limiter = new PublicShareRateLimiter();
  const mediaLimiter = new PublicShareMediaLimiter();

  router.onError((error, c) => {
    log.error("public_share.unhandled_error", { path: diagnosticRequestPath(c.req.path), method: c.req.method, errorType: error.name || "Error" });
    return c.json({ error: "request failed" }, 500);
  });

  router.use("*", async (c, next) => {
    const startedAt = Date.now();
    await next();
    c.header("Cache-Control", "private, no-store");
    c.header("Referrer-Policy", "no-referrer");
    c.header("X-Robots-Tag", "noindex, nofollow, noarchive");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    c.header("Content-Security-Policy", "default-src 'self'; base-uri 'none'; object-src 'none'; form-action 'none'; frame-ancestors 'none'; script-src 'self' https://www.youtube.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-src https://www.youtube-nocookie.com");
    const ms = Date.now() - startedAt;
    if (c.res.status >= 500) log.error("public_share.request_failed", { path: diagnosticRequestPath(c.req.path), method: c.req.method, status: c.res.status, ms });
    else if (ms >= 2_000) log.warn("public_share.request_slow", { path: diagnosticRequestPath(c.req.path), method: c.req.method, status: c.res.status, ms });
  });

  const rateLimit = (c: any): Response | null => {
    const token = c.req.param("token") ?? "invalid";
    const result = limiter.take(`${clientAddress(c)}:${token}`);
    if (result.allowed) return null;
    return c.json({ error: "rate limited" }, 429, { "Retry-After": String(result.retryAfter) });
  };

  router.get("/:token/data", async (c) => {
    const limited = rateLimit(c); if (limited) return limited;
    const token = c.req.param("token");
    const resolved = await resolvePublicShare(token);
    if (!resolved) return notFound(c);
    const requestedPage = Number(c.req.query("page") ?? 0);
    const page = Number.isSafeInteger(requestedPage) ? Math.min(10_000, Math.max(0, requestedPage)) : 0;
    const ids = await publicShareVideoIds(resolved.share, page);
    const selectedId = c.req.query("video") || ids[0] || null;
    if (selectedId && !await publicShareContainsVideo(resolved.share, selectedId)) return notFound(c);
    const [items, video] = await Promise.all([
      Promise.all(ids.map((id) => publicShareVideo(id))).then((rows) => rows.filter((row): row is PublicShareVideo => Boolean(row))),
      selectedId ? publicShareVideo(selectedId) : Promise.resolve(null),
    ]);
    if (selectedId && !video) return notFound(c);
    const [creators, subtitles, source] = video ? await Promise.all([
      publicShareCreators(video),
      subtitleCatalog(token, resolved.share, video.video_id),
      localMediaSource(resolved.share, video.video_id),
    ]) : [[], { subtitles: [], available: [] }, null];
    return c.json({
      brand: { name: getSetting("app_name") || "YT Zero", icon: "/favicon.svg", color: publicBrandColor() },
      resource: { type: resolved.share.resource_type, id: resolved.share.resource_id, ...resolved.resource },
      page,
      page_size: PUBLIC_SHARE_PAGE_SIZE,
      has_more: (page + 1) * PUBLIC_SHARE_PAGE_SIZE < resolved.resource.video_count,
      items: items.map((item) => publicVideoDto(token, item)),
      video: video ? publicVideoDto(token, video) : null,
      creators: video ? creators.map((creator) => publicCreatorDto(token, video.video_id, creator)) : [],
      chapters: publicShareChapters(video?.chapters_json ?? null),
      subtitles,
      playback: video ? source
        ? { kind: "local", source, url: `/share/${encodeURIComponent(token)}/media/${encodeURIComponent(video.video_id)}` }
        : { kind: "youtube", video_id: video.video_id }
        : null,
      allow_local_media: resolved.share.allow_local_media === 1,
    });
  });

  router.get("/:token/thumbnail/:videoId", async (c) => {
    const limited = rateLimit(c); if (limited) return limited;
    const authorized = await authorizedVideo(c.req.param("token"), c.req.param("videoId"));
    if (!authorized) return notFound(c);
    if (authorized.video.thumbnail.startsWith("/api/plugins/tubearchivist/thumbnail/")) {
      return await tubeArchivistResource(authorized.video.video_id, "thumbnail", undefined, c.req.raw.signal) ?? notFound(c);
    }
    const remote = extractRemoteThumbnail(authorized.video.thumbnail);
    return remote ? await remoteImageResponse(remote, c.req.raw.signal) ?? notFound(c) : notFound(c);
  });

  router.get("/:token/avatar/:videoId/:channelId", async (c) => {
    const limited = rateLimit(c); if (limited) return limited;
    const authorized = await authorizedVideo(c.req.param("token"), c.req.param("videoId"));
    if (!authorized) return notFound(c);
    const creator = (await publicShareCreators(authorized.video)).find((item) => item.channel_id === c.req.param("channelId"));
    if (!creator?.thumbnail) return notFound(c);
    const remote = extractRemoteThumbnail(creator.thumbnail);
    return remote ? await remoteImageResponse(remote, c.req.raw.signal) ?? notFound(c) : notFound(c);
  });

  router.get("/:token/subtitles/:videoId", async (c) => {
    const limited = rateLimit(c); if (limited) return limited;
    const authorized = await authorizedVideo(c.req.param("token"), c.req.param("videoId"));
    if (!authorized || authorized.share.allow_local_media !== 1) return notFound(c);
    return c.json(await subtitleCatalog(c.req.param("token"), authorized.share, authorized.video.video_id));
  });

  router.get("/:token/subtitles/:videoId/:lang", async (c) => {
    const limited = rateLimit(c); if (limited) return limited;
    const token = c.req.param("token");
    const videoId = c.req.param("videoId");
    const language = c.req.param("lang");
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(language)) return notFound(c);
    const authorized = await authorizedVideo(token, videoId);
    if (!authorized || authorized.share.allow_local_media !== 1) return notFound(c);
    if (await downloadedSource(authorized.share, videoId)) {
      const file = (await listSubtitleFiles(videoId)).find((subtitle) => normalizeSubtitleLanguage(subtitle.lang) === language);
      if (file && existsSync(file.path)) {
        let text = await Bun.file(file.path).text();
        if (file.ext === "srt") text = srtToVtt(text);
        return new Response(text, { headers: { "Content-Type": "text/vtt; charset=utf-8" } });
      }
    }
    return await tubeArchivistSubtitleResponse(videoId, language, c.req.raw.signal) ?? notFound(c);
  });

  router.on(["GET", "HEAD"], "/:token/media/:videoId", async (c) => {
    const token = c.req.param("token");
    const release = mediaLimiter.acquire(token);
    if (!release) return c.json({ error: "too many streams" }, 429, { "Retry-After": "1" });
    try {
      const authorized = await authorizedVideo(token, c.req.param("videoId"));
      if (!authorized || authorized.share.allow_local_media !== 1) {
        release();
        return notFound(c);
      }
      const download = await downloadedSource(authorized.share, authorized.video.video_id);
      if (download?.path) return responseWithLease(await localMediaResponse(download.path, c.req.header("range") ?? null, c.req.method === "HEAD"), release);
      const archived = await tubeArchivistResource(
        authorized.video.video_id,
        "media",
        c.req.method === "HEAD" ? "bytes=0-0" : c.req.header("range"),
        c.req.raw.signal,
      );
      if (!archived) {
        release();
        return notFound(c);
      }
      return responseWithLease(c.req.method === "HEAD" ? new Response(null, { status: archived.status, headers: archived.headers }) : archived, release);
    } catch (error) {
      release();
      throw error;
    }
  });

  const shell = async (c: any) => {
    const limited = rateLimit(c); if (limited) return limited;
    const token = c.req.param("token");
    if (!PUBLIC_SHARE_TOKEN_PATTERN.test(token)) return notFound(c);
    const resolved = await resolvePublicShare(token);
    if (!resolved) return notFound(c);
    const videoId = c.req.param("videoId");
    if (videoId && !await publicShareContainsVideo(resolved.share, videoId)) return notFound(c);
    const file = Bun.file(`${uiDir}/index.html`);
    if (!await file.exists()) return notFound(c);
    return new Response(file, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  };
  router.get("/:token", shell);
  router.get("/:token/video/:videoId", shell);

  return router;
}
