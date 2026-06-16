import { XMLParser } from "fast-xml-parser";

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  Cookie: "CONSENT=YES+cb.20240101-00-p0.en+FX+100; SOCS=CAI",
};

const RSS_HEADERS = {
  "User-Agent": FETCH_HEADERS["User-Agent"],
  "Accept-Language": FETCH_HEADERS["Accept-Language"],
};

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

export interface FeedVideo {
  videoId: string;
  title: string;
  description: string;
  thumbnail: string;
  publishedAt: string;
  views: number | null;
  likes: number | null;
}

export interface ChannelFeed {
  channelId: string;
  channelTitle: string;
  videos: FeedVideo[];
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

export async function fetchChannelFeed(channelId: string): Promise<ChannelFeed> {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  const res = await fetch(url, { headers: RSS_HEADERS });
  if (!res.ok) throw new Error(`RSS fetch failed (${res.status}) for ${channelId}`);
  const doc = xml.parse(await res.text());
  const feed = doc.feed ?? {};
  const videos: FeedVideo[] = asArray(feed.entry).map((e: any) => {
    const community = e["media:group"]?.["media:community"];
    const views = Number(community?.["media:statistics"]?.["@_views"]);
    const likes = Number(community?.["media:starRating"]?.["@_count"]);
    return {
      videoId: e["yt:videoId"] ?? "",
      title: String(e.title ?? ""),
      description: String(e["media:group"]?.["media:description"] ?? ""),
      thumbnail:
        e["media:group"]?.["media:thumbnail"]?.["@_url"] ??
        `https://i.ytimg.com/vi/${e["yt:videoId"]}/hqdefault.jpg`,
      publishedAt: e.published ?? "",
      views: Number.isFinite(views) ? views : null,
      likes: Number.isFinite(likes) ? likes : null,
    };
  });
  return {
    channelId,
    channelTitle: String(feed.title ?? ""),
    videos: videos.filter((v) => v.videoId),
  };
}

/** Resolve any YouTube channel URL or @handle to a channel ID (UC...). */
export async function resolveChannelId(input: string): Promise<{ channelId: string; title: string; thumbnail: string }> {
  let url = input.trim();
  if (/^UC[\w-]{22}$/.test(url)) {
    url = `https://www.youtube.com/channel/${url}`;
  } else if (url.startsWith("@")) {
    url = `https://www.youtube.com/${url}`;
  } else if (!/^https?:\/\//.test(url)) {
    url = `https://www.youtube.com/${url.replace(/^\/+/, "")}`;
  }
  const res = await fetch(url, { headers: FETCH_HEADERS, redirect: "follow" });
  if (!res.ok) throw new Error(`Nie udało się pobrać strony kanału (${res.status})`);
  const html = await res.text();
  // The canonical link is authoritative; "channelId" occurrences in page data
  // can belong to recommended channels.
  const idMatch =
    html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/) ??
    html.match(/"channelId":"(UC[\w-]{22})"/);
  if (!idMatch) throw new Error("Nie znaleziono channel ID na stronie");
  const titleMatch = html.match(/<meta property="og:title" content="([^"]*)"/);
  const thumbMatch = html.match(/<meta property="og:image" content="([^"]*)"/);
  return {
    channelId: idMatch[1],
    title: titleMatch?.[1] ?? "",
    thumbnail: thumbMatch?.[1] ?? "",
  };
}

export interface LiveInfo {
  videoId: string;
  title: string;
  thumbnail: string;
  isLiveNow: boolean;
  isUpcoming: boolean;
}

/**
 * Scrape https://www.youtube.com/channel/<id>/live to detect a current or
 * upcoming livestream. Returns null when the channel is not live.
 */
export async function fetchLiveInfo(channelId: string): Promise<LiveInfo | null> {
  const res = await fetch(`https://www.youtube.com/channel/${channelId}/live`, {
    headers: FETCH_HEADERS,
    redirect: "follow",
  });
  if (!res.ok) return null;
  const html = await res.text();

  // When the channel has a live/upcoming stream, /live canonicalizes to the
  // watch page; otherwise it canonicalizes back to the channel page.
  const videoIdMatch = html.match(
    /<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/
  );
  if (!videoIdMatch) return null;

  // "isLive":true is set only while the stream is actually broadcasting;
  // ended streams keep "isLiveContent":true but drop "isLive".
  const isUpcoming = /"isUpcoming"\s*:\s*true/.test(html);
  const isLiveNow = !isUpcoming && /"isLive"\s*:\s*true/.test(html);
  if (!isLiveNow && !isUpcoming) return null;

  const titleMatch = html.match(/<meta name="title" content="([^"]*)"/);
  return {
    videoId: videoIdMatch[1],
    title: titleMatch?.[1] ?? "",
    thumbnail: `https://i.ytimg.com/vi/${videoIdMatch[1]}/hqdefault.jpg`,
    isLiveNow,
    isUpcoming: !isLiveNow && isUpcoming,
  };
}

/** Extract the ytInitialData JSON blob embedded in a YouTube page. */
function extractVariable(html: string, name: string): any | null {
  const marker = `${name} = `;
  const idx = html.indexOf(marker);
  if (idx < 0) return null;
  // Find the start of the JSON object/array.
  let start = idx + marker.length;
  const open = html[start];
  if (open !== "{" && open !== "[") return null;
  const close = open === "{" ? "}" : "]";
  // Brace-match while respecting string literals and escapes, because the
  // surrounding <script> can contain trailing JS after the JSON (e.g.
  // ytInitialPlayerResponse is followed by more code in the same tag).
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function extractInitialData(html: string): any | null {
  return extractVariable(html, "ytInitialData");
}

/** Collect every value stored under the given key anywhere in a JSON tree. */
function deepCollect(node: any, key: string, out: any[] = []): any[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const item of node) deepCollect(item, key, out);
    return out;
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === key) out.push(v);
    deepCollect(v, key, out);
  }
  return out;
}

export interface ChannelLink {
  title: string;
  url: string;
}

export interface ChannelAbout {
  channelId: string;
  title: string;
  description: string;
  avatar: string;
  banner: string;
  stats: string[];
  links: ChannelLink[];
  joinedDate: string;
  viewCount: string;
  handle: string;
}

const aboutCache = new Map<string, { at: number; data: ChannelAbout }>();
const ABOUT_TTL = 10 * 60_000;

export async function fetchChannelAbout(channelId: string): Promise<ChannelAbout> {
  const cached = aboutCache.get(channelId);
  if (cached && Date.now() - cached.at < ABOUT_TTL) return cached.data;

  const [res, aboutRes] = await Promise.all([
    fetch(`https://www.youtube.com/channel/${channelId}`, { headers: FETCH_HEADERS }),
    fetch(`https://www.youtube.com/channel/${channelId}/about`, { headers: FETCH_HEADERS }),
  ]);
  if (!res.ok) throw new Error(`channel page fetch failed (${res.status})`);
  const html = await res.text();
  const data = extractInitialData(html);
  const meta = data?.metadata?.channelMetadataRenderer ?? {};

  // Parse /about tab for links, dates, view count
  let links: ChannelLink[] = [];
  let joinedDate = "";
  let viewCount = "";
  let handle = "";
  if (aboutRes.ok) {
    const aboutData = extractInitialData(await aboutRes.text());
    const vm = deepCollect(aboutData, "aboutChannelViewModel")[0];
    if (vm) {
      // Strip "Joined " prefix — date is reformatted in the UI with the right locale
      const rawJoined: string = vm.joinedDateText?.content ?? "";
      joinedDate = rawJoined.replace(/^joined\s*/i, "").trim();
      viewCount = (vm.viewCountText ?? "").replace(/\s*views?\s*/i, "").trim();
      handle = vm.canonicalChannelUrl?.replace(/^https?:\/\/www\.youtube\.com\//, "") ?? "";
      for (const l of deepCollect(aboutData, "channelExternalLinkViewModel")) {
        const title = l?.title?.content ?? "";
        const rawUrl: string = l?.link?.commandRuns?.[0]?.onTap?.innertubeCommand?.urlEndpoint?.url ?? "";
        if (!title || !rawUrl) continue;
        // YouTube wraps external links in a redirect — extract the real URL from `q=`
        let url = rawUrl;
        try {
          const u = new URL(rawUrl);
          const q = u.searchParams.get("q");
          if (q) url = q;
        } catch {}
        links.push({ title, url });
      }
    }
  }

  // Banner lives in the (frequently restructured) header; try both layouts.
  const bannerSources =
    deepCollect(data?.header, "imageBannerViewModel")[0]?.image?.sources ??
    data?.header?.c4TabbedHeaderRenderer?.banner?.thumbnails ??
    [];
  const banner = bannerSources.at(-1)?.url ?? "";

  // Subscriber / video counts: gather the short metadata texts from the header.
  // Prioritise the subscriber count string (contains "subscriber") so stats[0]
  // is always the sub count, not a @handle or video count.
  const stats: string[] = [];
  const statsOther: string[] = [];
  for (const parts of deepCollect(data?.header, "metadataParts")) {
    for (const p of Array.isArray(parts) ? parts : []) {
      const t = p?.text?.content;
      if (typeof t !== "string" || !t || t.length >= 40) continue;
      if (/subscriber/i.test(t)) stats.push(t.replace(/\s*subscribers?\s*/i, "").trim());
      else if (/\bvideos?\b/i.test(t)) statsOther.push(t.replace(/\s*videos?\s*/i, "").trim());
      else statsOther.push(t);
    }
  }
  const subLegacy = data?.header?.c4TabbedHeaderRenderer?.subscriberCountText?.simpleText;
  if (subLegacy && stats.length === 0) stats.push(subLegacy.replace(/\s*subscribers?\s*/i, "").trim());
  stats.push(...statsOther);

  const about: ChannelAbout = {
    channelId,
    title: meta.title ?? "",
    description: meta.description ?? "",
    avatar: meta.avatar?.thumbnails?.at(-1)?.url ?? "",
    banner,
    stats: [...new Set(stats)],
    links,
    joinedDate,
    viewCount,
    handle,
  };
  aboutCache.set(channelId, { at: Date.now(), data: about });
  return about;
}

export interface PlaylistInfo {
  playlistId: string;
  title: string;
  thumbnail: string;
  videoCount: string;
}

const playlistCache = new Map<string, { at: number; data: PlaylistInfo[] }>();

export async function fetchChannelPlaylists(channelId: string): Promise<PlaylistInfo[]> {
  const cached = playlistCache.get(channelId);
  if (cached && Date.now() - cached.at < ABOUT_TTL) return cached.data;

  const res = await fetch(`https://www.youtube.com/channel/${channelId}/playlists`, {
    headers: FETCH_HEADERS,
  });
  if (!res.ok) throw new Error(`playlists fetch failed (${res.status})`);
  const data = extractInitialData(await res.text());
  const out: PlaylistInfo[] = [];
  const seen = new Set<string>();

  // Legacy markup.
  for (const r of deepCollect(data, "gridPlaylistRenderer")) {
    if (!r?.playlistId || seen.has(r.playlistId)) continue;
    seen.add(r.playlistId);
    out.push({
      playlistId: r.playlistId,
      title: r.title?.runs?.[0]?.text ?? r.title?.simpleText ?? "",
      thumbnail: r.thumbnail?.thumbnails?.at(-1)?.url ?? "",
      videoCount: r.videoCountShortText?.simpleText ?? "",
    });
  }
  // Current markup (lockup view models).
  for (const vm of deepCollect(data, "lockupViewModel")) {
    const id = vm?.contentId;
    if (!id || seen.has(id) || !String(vm?.contentType ?? "").includes("PLAYLIST")) continue;
    seen.add(id);
    const badges = deepCollect(vm, "thumbnailBadgeViewModel")
      .map((b: any) => b?.text)
      .filter((t: any) => typeof t === "string");
    out.push({
      playlistId: id,
      title: vm?.metadata?.lockupMetadataViewModel?.title?.content ?? "",
      thumbnail: deepCollect(vm, "sources")[0]?.[0]?.url ?? "",
      videoCount: badges[0] ?? "",
    });
  }
  playlistCache.set(channelId, { at: Date.now(), data: out });
  return out;
}

export interface PlaylistVideo {
  videoId: string;
  title: string;
  thumbnail: string;
  channelTitle: string;
  duration: string;
  index: number;
}

const playlistFeedCache = new Map<string, { at: number; data: PlaylistFeed }>();

export interface PlaylistFeed {
  playlistId: string;
  /** Channel that owns the playlist (from the feed's top-level yt:channelId). */
  channelId: string;
  channelTitle: string;
  videos: FeedVideo[];
}

export interface VideoDuration { videoId: string; duration: string; }

export async function fetchChannelVideosDurations(channelId: string): Promise<VideoDuration[]> {
  const res = await fetch(`https://www.youtube.com/channel/${channelId}/videos`, { headers: FETCH_HEADERS });
  if (!res.ok) return [];
  const data = extractInitialData(await res.text());
  const out: VideoDuration[] = [];
  for (const r of deepCollect(data, "videoRenderer")) {
    if (r?.videoId && r?.lengthText?.simpleText) {
      out.push({ videoId: r.videoId, duration: r.lengthText.simpleText });
    }
  }
  return out;
}

/**
 * Fetch a playlist via its RSS feed (`?playlist_id=`), which shares the Atom
 * format used by channel feeds. More reliable than scraping the playlist page,
 * but capped at ~15 entries and without per-video duration.
 */
export async function fetchPlaylistFeed(playlistId: string): Promise<PlaylistFeed> {
  const cached = playlistFeedCache.get(playlistId);
  if (cached && Date.now() - cached.at < ABOUT_TTL) return cached.data;

  const url = `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`;
  const res = await fetch(url, { headers: RSS_HEADERS });
  if (!res.ok) throw new Error(`playlist feed fetch failed (${res.status})`);
  const doc = xml.parse(await res.text());
  const feed = doc.feed ?? {};
  const videos: FeedVideo[] = asArray(feed.entry)
    .map((e: any): FeedVideo => {
      const community = e["media:group"]?.["media:community"];
      const views = Number(community?.["media:statistics"]?.["@_views"]);
      const likes = Number(community?.["media:starRating"]?.["@_count"]);
      const videoId = e["yt:videoId"] ?? "";
      return {
        videoId,
        title: String(e["media:group"]?.["media:title"] ?? e.title ?? ""),
        description: String(e["media:group"]?.["media:description"] ?? ""),
        thumbnail:
          e["media:group"]?.["media:thumbnail"]?.["@_url"] ??
          `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        publishedAt: e.published ?? "",
        views: Number.isFinite(views) ? views : null,
        likes: Number.isFinite(likes) ? likes : null,
      };
    })
    .filter((v) => v.videoId);

  const data: PlaylistFeed = {
    playlistId,
    channelId: String(feed["yt:channelId"] ?? ""),
    channelTitle: String(feed.author?.name ?? feed.title ?? ""),
    videos,
  };
  playlistFeedCache.set(playlistId, { at: Date.now(), data });
  return data;
}

/** Playlist videos shaped for the watch-page sidebar (no duration in RSS). */
export async function fetchPlaylistVideos(playlistId: string): Promise<PlaylistVideo[]> {
  const feed = await fetchPlaylistFeed(playlistId);
  return feed.videos.map((v, i) => ({
    videoId: v.videoId,
    title: v.title,
    thumbnail: v.thumbnail,
    channelTitle: feed.channelTitle,
    duration: "",
    index: i,
  }));
}

export interface ScrapedVideo {
  videoId: string;
  title: string;
  thumbnail: string;
  duration: string;
  viewCount: number | null;
}

/**
 * Scrape the channel's /videos tab to get more video IDs than the RSS feed.
 * Returns up to ~30 recent videos with basic metadata (no description/published_at).
 */
export async function fetchChannelVideos(channelId: string): Promise<ScrapedVideo[]> {
  const res = await fetch(`https://www.youtube.com/channel/${channelId}/videos`, { headers: FETCH_HEADERS });
  if (!res.ok) return [];
  const data = extractInitialData(await res.text());
  const out: ScrapedVideo[] = [];
  for (const r of deepCollect(data, "videoRenderer")) {
    if (!r?.videoId) continue;
    const viewStr =
      r?.viewCountText?.simpleText ?? r?.viewCountText?.runs?.[0]?.text ?? "";
    const viewNum = parseInt(viewStr.replace(/\D/g, ""), 10);
    out.push({
      videoId: r.videoId,
      title: r.title?.runs?.[0]?.text ?? r.title?.simpleText ?? "",
      thumbnail:
        r.thumbnail?.thumbnails?.at(-1)?.url ??
        `https://i.ytimg.com/vi/${r.videoId}/hqdefault.jpg`,
      duration: r.lengthText?.simpleText ?? "",
      viewCount: Number.isFinite(viewNum) && viewNum > 0 ? viewNum : null,
    });
  }
  return out;
}

export interface SearchResult {
  videoId: string;
  title: string;
  thumbnail: string;
  duration: string;
  channelTitle: string;
  viewCount: number | null;
}

const searchCache = new Map<string, { at: number; data: SearchResult[] }>();
const SEARCH_TTL = 5 * 60_000;

export async function searchYouTube(query: string): Promise<SearchResult[]> {
  const cached = searchCache.get(query);
  if (cached && Date.now() - cached.at < SEARCH_TTL) return cached.data;

  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: FETCH_HEADERS });
  if (!res.ok) throw new Error(`YouTube search failed (${res.status})`);
  const data = extractInitialData(await res.text());
  const out: SearchResult[] = [];
  for (const r of deepCollect(data, "videoRenderer")) {
    if (!r?.videoId) continue;
    const viewStr = r?.viewCountText?.simpleText ?? r?.viewCountText?.runs?.[0]?.text ?? "";
    const viewNum = parseInt(viewStr.replace(/\D/g, ""), 10);
    out.push({
      videoId: r.videoId,
      title: r.title?.runs?.[0]?.text ?? r.title?.simpleText ?? "",
      thumbnail: r.thumbnail?.thumbnails?.at(-1)?.url ?? `https://i.ytimg.com/vi/${r.videoId}/hqdefault.jpg`,
      duration: r.lengthText?.simpleText ?? "",
      channelTitle: r.shortBylineText?.runs?.[0]?.text ?? "",
      viewCount: Number.isFinite(viewNum) && viewNum > 0 ? viewNum : null,
    });
  }
  const result = out.slice(0, 20);
  searchCache.set(query, { at: Date.now(), data: result });
  return result;
}

export interface VideoInfo {
  videoId: string;
  title: string;
  channelId: string;
  channelTitle: string;
  description: string;
  thumbnail: string;
  viewCount: number | null;
  publishedAt: string | null;
  duration: string | null;
}

const videoInfoCache = new Map<string, { at: number; data: VideoInfo }>();
const VIDEO_INFO_TTL = 10 * 60_000;

export async function fetchVideoInfo(videoId: string): Promise<VideoInfo> {
  const cached = videoInfoCache.get(videoId);
  if (cached && Date.now() - cached.at < VIDEO_INFO_TTL) return cached.data;

  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const res = await fetch(url, { headers: FETCH_HEADERS });
  if (!res.ok) throw new Error(`YouTube fetch failed (${res.status})`);
  const html = await res.text();
  const pr = extractVariable(html, "ytInitialPlayerResponse");
  const vd = pr?.videoDetails;
  if (!vd?.videoId) throw new Error("videoDetails missing");

  const mf = pr?.microformat?.playerMicroformatRenderer;
  const lengthSec = parseInt(vd.lengthSeconds ?? "", 10);
  const duration = Number.isFinite(lengthSec) && lengthSec > 0
    ? `${Math.floor(lengthSec / 60)}:${String(lengthSec % 60).padStart(2, "0")}`
    : null;

  const result: VideoInfo = {
    videoId: vd.videoId,
    title: vd.title ?? "",
    channelId: vd.channelId ?? "",
    channelTitle: vd.author ?? mf?.ownerChannelName ?? "",
    description: vd.shortDescription ?? "",
    thumbnail: vd.thumbnail?.thumbnails?.at(-1)?.url
      ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    viewCount: parseInt(vd.viewCount ?? "", 10) || null,
    publishedAt: mf?.publishDate ?? null,
    duration,
  };
  videoInfoCache.set(videoId, { at: Date.now(), data: result });
  return result;
}

export interface VideoChapter {
  title: string;
  /** Start offset in whole seconds. */
  start: number;
}

const chaptersCache = new Map<string, { at: number; data: VideoChapter[] }>();
const CHAPTERS_TTL = 60 * 60_000;

/**
 * Scrape a video's chapter list from the watch page (same source as durations).
 * Chapters live in `ytInitialData` under `chapterRenderer` — YouTube derives
 * them from description timestamps or creator-defined markers. Returns an empty
 * list when the video has no chapters. No YouTube API involved.
 */
export async function fetchVideoChapters(videoId: string): Promise<VideoChapter[]> {
  const cached = chaptersCache.get(videoId);
  if (cached && Date.now() - cached.at < CHAPTERS_TTL) return cached.data;

  const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, { headers: FETCH_HEADERS });
  if (!res.ok) return [];
  const data = extractInitialData(await res.text());
  const out: VideoChapter[] = [];
  const seen = new Set<number>();
  for (const ch of deepCollect(data, "chapterRenderer")) {
    const title = ch?.title?.simpleText;
    const start = Math.floor(Number(ch?.timeRangeStartMillis) / 1000);
    if (typeof title !== "string" || !title || !Number.isFinite(start) || seen.has(start)) continue;
    seen.add(start);
    out.push({ title, start });
  }
  out.sort((a, b) => a.start - b.start);
  chaptersCache.set(videoId, { at: Date.now(), data: out });
  return out;
}

/**
 * Detect whether a video is a YouTube Short. /shorts/<id> responds 200 for
 * Shorts and redirects (303) to /watch for regular videos.
 */
export async function checkIsShort(videoId: string, title: string): Promise<boolean> {
  if (/#shorts?\b/i.test(title)) return true;
  try {
    const res = await fetch(`https://www.youtube.com/shorts/${videoId}`, {
      method: "HEAD",
      redirect: "manual",
      headers: FETCH_HEADERS,
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

/** Parse an OPML export (e.g. from NewPipe/FreeTube) into channel IDs. */
export function parseOpml(content: string): { channelId: string; title: string }[] {
  const doc = xml.parse(content);
  const result: { channelId: string; title: string }[] = [];
  const walk = (node: any) => {
    for (const outline of asArray<any>(node?.outline)) {
      const xmlUrl: string = outline["@_xmlUrl"] ?? "";
      const m = xmlUrl.match(/channel_id=(UC[\w-]{22})/);
      if (m) result.push({ channelId: m[1], title: outline["@_title"] ?? outline["@_text"] ?? "" });
      walk(outline);
    }
  };
  walk(doc?.opml?.body ?? {});
  return result;
}

/** Parse a Google Takeout subscriptions.csv (Channel Id, Channel Url, Channel Title). */
export function parseTakeoutCsv(content: string): { channelId: string; title: string }[] {
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  const result: { channelId: string; title: string }[] = [];
  for (const line of lines) {
    const m = line.match(/(UC[\w-]{22})/);
    if (!m) continue;
    // Title is the last CSV column; tolerate commas elsewhere.
    const cols = line.split(",");
    result.push({ channelId: m[1], title: cols.length >= 3 ? cols.slice(2).join(",").trim() : "" });
  }
  return result;
}
