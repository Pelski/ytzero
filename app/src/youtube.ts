import { XMLParser } from "fast-xml-parser";
import { createRequire } from "module";
import { decodeHtmlEntities } from "./htmlEntities";
const _require = createRequire(import.meta.url);
const InnerTubeClient = _require("innertube.js");
const _yt = new InnerTubeClient();

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
      title: decodeHtmlEntities(String(e.title ?? "")),
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
    channelTitle: decodeHtmlEntities(String(feed.title ?? "")),
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
    title: decodeHtmlEntities(titleMatch?.[1] ?? ""),
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
    title: decodeHtmlEntities(titleMatch?.[1] ?? ""),
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

function isSubscriberText(text: string): boolean {
  return /(subscribers?|subskryb|abonn|suscrip|inscrito|iscritt)/i.test(text);
}

function isVideoCountText(text: string): boolean {
  return /\b(videos?|film(?:y|ów)?)\b/i.test(text);
}

function cleanSubscriberCount(text: string): string {
  return text
    .replace(/subscribers?/gi, "")
    .replace(/subskrybent(?:ów|y)?/gi, "")
    .replace(/subskrypcji/gi, "")
    .replace(/abonn(?:és|enten)?/gi, "")
    .replace(/suscriptores?/gi, "")
    .replace(/inscritos?/gi, "")
    .replace(/iscritti/gi, "")
    .replace(/[•·]/g, "")
    .trim();
}

function cleanVideoCount(text: string): string {
  return text
    .replace(/\s*(videos?|film(?:y|ów)?)\s*/gi, "")
    .replace(/[•·]/g, "")
    .trim();
}

function textFromMetadataPart(part: any): string[] {
  return [part?.text?.content, part?.accessibilityLabel]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function extractHeaderStats(data: any): { subscriberCount: string; stats: string[] } {
  const pageHeader = deepCollect(data, "pageHeaderRenderer")[0];
  const headerMetadata = pageHeader?.content?.pageHeaderViewModel?.metadata?.contentMetadataViewModel;
  const metadataRows = Array.isArray(headerMetadata?.metadataRows) ? headerMetadata.metadataRows : [];
  const stats: string[] = [];
  let subscriberCount = "";

  for (const row of metadataRows) {
    for (const part of Array.isArray(row?.metadataParts) ? row.metadataParts : []) {
      const texts = textFromMetadataPart(part);
      const visible = texts[0] ?? "";
      const searchable = texts.join(" ");
      if (!visible || visible.length >= 80) continue;
      if (visible.startsWith("@")) continue;
      if (isSubscriberText(searchable)) {
        subscriberCount ||= cleanSubscriberCount(visible);
      } else if (isVideoCountText(searchable)) {
        stats.push(cleanVideoCount(visible));
      }
    }
  }

  if (subscriberCount || stats.length > 0) {
    return { subscriberCount, stats: [...new Set(stats.filter(Boolean))] };
  }

  const fallbackStats: string[] = [];
  for (const parts of deepCollect(data, "metadataParts")) {
    for (const part of Array.isArray(parts) ? parts : []) {
      const texts = textFromMetadataPart(part);
      const visible = texts[0] ?? "";
      const searchable = texts.join(" ");
      if (!visible || visible.length >= 80 || visible.startsWith("@")) continue;
      if (isSubscriberText(searchable)) subscriberCount ||= cleanSubscriberCount(visible);
      else if (isVideoCountText(searchable)) fallbackStats.push(cleanVideoCount(visible));
    }
    if (subscriberCount) break;
  }
  return { subscriberCount, stats: [...new Set(fallbackStats.filter(Boolean))] };
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
  subscriberCount: string;
  stats: string[];
  links: ChannelLink[];
  joinedDate: string;
  viewCount: string;
  handle: string;
}

export interface WatchSubscriberCount {
  subscriberCount: string;
  videoId: string;
  ownerChannelId: string;
  ownerTitle: string;
}

const aboutCache = new Map<string, { at: number; data: ChannelAbout }>();
const ABOUT_TTL = 10 * 60_000;

export async function fetchChannelAbout(channelId: string): Promise<ChannelAbout> {
  const cached = aboutCache.get(channelId);
  if (cached && Date.now() - cached.at < ABOUT_TTL) return cached.data;

  const data = await _yt.getChannel({ channelId });

  const meta = deepCollect(data, "channelMetadataRenderer")[0] ?? {};
  const avatar: string = meta.avatar?.thumbnails?.at(-1)?.url ?? "";
  const title = decodeHtmlEntities(String(meta.title ?? ""));
  const description: string = meta.description ?? "";
  const handle: string =
    (meta.vanityChannelUrl ?? "").replace(/^https?:\/\/www\.youtube\.com\//, "") ||
    (meta.ownerUrls?.[0] ?? "").replace(/^https?:\/\/www\.youtube\.com\//, "");

  const banner: string =
    deepCollect(data, "imageBannerViewModel")[0]?.image?.sources?.at(-1)?.url ?? "";

  const { subscriberCount, stats } = extractHeaderStats(data);

  const about: ChannelAbout = {
    channelId,
    title,
    description,
    avatar,
    banner,
    subscriberCount,
    stats: [...new Set(stats)],
    links: [],
    joinedDate: "",
    viewCount: "",
    handle,
  };
  aboutCache.set(channelId, { at: Date.now(), data: about });
  return about;
}

function extractSubscriberCountText(node: any): string {
  const simple = node?.simpleText;
  if (typeof simple === "string" && isSubscriberText(simple)) {
    return cleanSubscriberCount(simple);
  }
  const label = node?.accessibility?.accessibilityData?.label;
  if (typeof label === "string" && isSubscriberText(label)) {
    return cleanSubscriberCount(label);
  }
  return "";
}

export async function fetchVideoOwnerSubscriberCount(videoId: string): Promise<WatchSubscriberCount | null> {
  const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, { headers: FETCH_HEADERS });
  if (!res.ok) return null;
  const data = extractInitialData(await res.text());
  const owner = deepCollect(data, "videoOwnerRenderer")[0];
  if (!owner) return null;
  const subscriberCount = extractSubscriberCountText(owner.subscriberCountText);
  if (!subscriberCount) return null;
  return {
    subscriberCount,
    videoId,
    ownerChannelId: owner.navigationEndpoint?.browseEndpoint?.browseId ?? "",
    ownerTitle: decodeHtmlEntities(owner.title?.runs?.[0]?.text ?? owner.title?.simpleText ?? ""),
  };
}

export async function fetchChannelSubscriberCountFromWatch(channelId: string): Promise<WatchSubscriberCount | null> {
  const feed = await fetchChannelFeed(channelId);
  for (const video of feed.videos.slice(0, 3)) {
    const result = await fetchVideoOwnerSubscriberCount(video.videoId);
    if (result?.subscriberCount) return result;
  }
  return null;
}

export interface PlaylistInfo {
  playlistId: string;
  title: string;
  thumbnail: string;
  videoCount: string;
}

const playlistCache = new Map<string, { at: number; data: PlaylistInfo[]; complete: boolean }>();
const MAX_PLAYLIST_CONTINUATION_PAGES = 50;

function collectChannelPlaylists(data: any, out: PlaylistInfo[], seen: Set<string>) {
  // Legacy markup.
  for (const r of deepCollect(data, "gridPlaylistRenderer")) {
    if (!r?.playlistId || seen.has(r.playlistId)) continue;
    seen.add(r.playlistId);
    out.push({
      playlistId: r.playlistId,
      title: decodeHtmlEntities(r.title?.runs?.[0]?.text ?? r.title?.simpleText ?? ""),
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
      title: decodeHtmlEntities(vm?.metadata?.lockupMetadataViewModel?.title?.content ?? ""),
      thumbnail: deepCollect(vm, "sources")[0]?.[0]?.url ?? "",
      videoCount: badges[0] ?? "",
    });
  }
}

function playlistContinuationToken(data: any): string | null {
  for (const renderer of deepCollect(data, "continuationItemRenderer")) {
    const token = renderer?.continuationEndpoint?.continuationCommand?.token;
    if (typeof token === "string" && token) return token;
  }
  return null;
}

function innertubePlaylistConfig(html: string): { apiKey: string; clientVersion: string } | null {
  const apiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1];
  const clientVersion = html.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/)?.[1];
  return apiKey && clientVersion ? { apiKey, clientVersion } : null;
}

async function fetchPlaylistContinuation(token: string, config: { apiKey: string; clientVersion: string }) {
  const res = await fetch(`https://www.youtube.com/youtubei/v1/browse?prettyPrint=false&key=${encodeURIComponent(config.apiKey)}`, {
    method: "POST",
    headers: { ...FETCH_HEADERS, "Content-Type": "application/json", Origin: "https://www.youtube.com" },
    body: JSON.stringify({
      context: { client: { clientName: "WEB", clientVersion: config.clientVersion, hl: "en", gl: "US" } },
      continuation: token,
    }),
  });
  if (!res.ok) throw new Error(`playlist continuation fetch failed (${res.status})`);
  return res.json();
}

export async function fetchChannelPlaylists(channelId: string): Promise<PlaylistInfo[]> {
  const cached = playlistCache.get(channelId);
  // Older versions cached only YouTube's first page (~30 cards). Re-fetch that
  // boundary case once so it is upgraded to a complete paginated result.
  if (cached && cached.complete && Date.now() - cached.at < ABOUT_TTL) return cached.data;

  const res = await fetch(`https://www.youtube.com/channel/${channelId}/playlists`, {
    headers: FETCH_HEADERS,
  });
  if (!res.ok) throw new Error(`playlists fetch failed (${res.status})`);
  const html = await res.text();
  const data = extractInitialData(html);
  const out: PlaylistInfo[] = [];
  const seen = new Set<string>();
  collectChannelPlaylists(data, out, seen);

  // Channel pages render only the first ~30 playlists. Follow the browse API
  // continuation tokens so a channel's remaining playlists are not invisible.
  const config = innertubePlaylistConfig(html);
  let token = playlistContinuationToken(data);
  for (let page = 0; config && token && page < MAX_PLAYLIST_CONTINUATION_PAGES; page++) {
    const previousToken = token;
    try {
      const continuation = await fetchPlaylistContinuation(token, config);
      collectChannelPlaylists(continuation, out, seen);
      token = playlistContinuationToken(continuation);
      if (token === previousToken) break;
    } catch {
      // Keep the already-collected pages usable if YouTube throttles a later one.
      break;
    }
  }
  playlistCache.set(channelId, { at: Date.now(), data: out, complete: true });
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
        title: decodeHtmlEntities(String(e["media:group"]?.["media:title"] ?? e.title ?? "")),
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
    channelTitle: decodeHtmlEntities(String(feed.author?.name ?? feed.title ?? "")),
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
  publishedAt: string | null;
  publishedAtApproximate: boolean;
  membersOnly: boolean;
  isStream?: boolean;
  isLive?: boolean;
}

export function hasMembersOnlyBadge(node: any): boolean {
  return deepCollect(node, "badgeViewModel").some((badge: any) =>
    badge?.badgeStyle === "BADGE_MEMBERS_ONLY" || badge?.iconName === "SPONSORSHIP_STAR"
  ) || deepCollect(node, "metadataBadgeRenderer").some((badge: any) =>
    badge?.style === "BADGE_STYLE_TYPE_MEMBERS_ONLY"
  );
}

function relativePublishedFromNode(node: any): string | null {
  for (const parts of deepCollect(node, "metadataParts")) {
    for (const part of Array.isArray(parts) ? parts : []) {
      for (const text of textFromMetadataPart(part)) {
        const parsed = parsePublishedTimeText(text);
        if (parsed) return relativePublishedAt(parsed);
      }
    }
  }
  const legacy = node?.publishedTimeText?.simpleText
    ?? node?.publishedTimeText?.runs?.map((part: any) => part.text).join("");
  const parsed = parsePublishedTimeText(legacy);
  return parsed ? relativePublishedAt(parsed) : null;
}

/**
 * Scrape a channel tab to get more video IDs than the RSS feed. YouTube keeps
 * completed livestreams in a separate /streams tab, rather than /videos.
 * Each tab returns up to ~30 recent entries with basic metadata.
 */
async function fetchChannelTabVideos(channelId: string, tab: "videos" | "streams"): Promise<ScrapedVideo[]> {
  const res = await fetch(`https://www.youtube.com/channel/${channelId}/${tab}`, { headers: FETCH_HEADERS });
  if (!res.ok) return [];
  const data = extractInitialData(await res.text());
  const out: ScrapedVideo[] = [];
  const seen = new Set<string>();
  for (const r of deepCollect(data, "videoRenderer")) {
    if (!r?.videoId || seen.has(r.videoId)) continue;
    seen.add(r.videoId);
    const viewStr =
      r?.viewCountText?.simpleText ?? r?.viewCountText?.runs?.[0]?.text ?? "";
    const viewNum = parseInt(viewStr.replace(/\D/g, ""), 10);
    out.push({
      videoId: r.videoId,
      title: decodeHtmlEntities(r.title?.runs?.[0]?.text ?? r.title?.simpleText ?? ""),
      thumbnail:
        r.thumbnail?.thumbnails?.at(-1)?.url ??
        `https://i.ytimg.com/vi/${r.videoId}/hqdefault.jpg`,
      duration: r.lengthText?.simpleText ?? "",
      viewCount: Number.isFinite(viewNum) && viewNum > 0 ? viewNum : null,
      publishedAt: relativePublishedFromNode(r),
      publishedAtApproximate: true,
      membersOnly: hasMembersOnlyBadge(r),
    });
  }

  // Current YouTube channel pages use richItemRenderer / lockupViewModel
  // cards instead of videoRenderer. This is notably used by /streams, so
  // without it completed streams are silently skipped.
  for (const vm of deepCollect(data, "lockupViewModel")) {
    const videoId = deepCollect(vm, "watchEndpoint")[0]?.videoId;
    if (!videoId || seen.has(videoId)) continue;
    const title = vm?.metadata?.lockupMetadataViewModel?.title?.content;
    if (!title) continue;
    seen.add(videoId);
    const badges = deepCollect(vm, "thumbnailBadgeViewModel")
      .map((badge: any) => badge?.text)
      .filter((text: any): text is string => typeof text === "string");
    out.push({
      videoId,
      title: decodeHtmlEntities(title),
      thumbnail:
        vm?.contentImage?.thumbnailViewModel?.image?.sources?.at(-1)?.url ??
        `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      duration: badges.find((text) => /^\d{1,2}:\d{2}(?::\d{2})?$/.test(text)) ?? "",
      viewCount: null,
      publishedAt: relativePublishedFromNode(vm),
      publishedAtApproximate: true,
      membersOnly: hasMembersOnlyBadge(vm),
      isLive: badges.includes("LIVE"),
    });
  }
  return out;
}

/** Scrape the channel's ordinary uploads tab. */
export async function fetchChannelVideos(channelId: string): Promise<ScrapedVideo[]> {
  return fetchChannelTabVideos(channelId, "videos");
}

/** Scrape the channel's current and archived livestreams tab. */
export async function fetchChannelStreams(channelId: string): Promise<ScrapedVideo[]> {
  return (await fetchChannelTabVideos(channelId, "streams")).map((video) => ({ ...video, isStream: true }));
}

export interface SearchResult {
  videoId: string;
  title: string;
  thumbnail: string;
  duration: string;
  channelTitle: string;
  channelAvatar: string | null;
  viewCount: number | null;
  published: PublishedAgo | null;
}

export interface ChannelSearchResult {
  channelId: string;
  title: string;
  thumbnail: string;
  handle: string;
  subscriberCount: string;
  videoCount: string;
}

export interface PublishedAgo {
  value: number;
  unit: "second" | "minute" | "hour" | "day" | "week" | "month" | "year";
}

// YouTube only exposes a relative label here ("3 days ago", "Streamed 2 weeks ago");
// English wording is guaranteed by the Accept-Language pin in FETCH_HEADERS.
export function parsePublishedTimeText(text: string | undefined): PublishedAgo | null {
  if (!text) return null;
  const english = text.match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i);
  if (english) return { value: parseInt(english[1], 10), unit: english[2].toLowerCase() as PublishedAgo["unit"] };

  const polish = text.match(/(\d+)\s+(sekund(?:ę|y)?|minut(?:ę|y)?|godzin(?:ę|y)?|dzień|dni|tydzień|tygodnie|tygodni|miesiąc|miesiące|miesięcy|rok|lata|lat)\s+temu/i);
  if (polish) {
    const word = polish[2].toLowerCase();
    const unit: PublishedAgo["unit"] = word.startsWith("sekund") ? "second"
      : word.startsWith("minut") ? "minute"
      : word.startsWith("godzin") ? "hour"
      : word === "dzień" || word === "dni" ? "day"
      : word.startsWith("tygod") ? "week"
      : word.startsWith("miesi") ? "month"
      : "year";
    return { value: parseInt(polish[1], 10), unit };
  }

  const german = text.match(/vor\s+(\d+)\s+(Sekunde[n]?|Minute[n]?|Stunde[n]?|Tag(?:en)?|Woche[n]?|Monat(?:en)?|Jahr(?:en)?)/i);
  if (!german) return null;
  const word = german[2].toLowerCase();
  const unit: PublishedAgo["unit"] = word.startsWith("sekunde") ? "second"
    : word.startsWith("minute") ? "minute"
    : word.startsWith("stunde") ? "hour"
    : word.startsWith("tag") ? "day"
    : word.startsWith("woche") ? "week"
    : word.startsWith("monat") ? "month"
    : "year";
  return { value: parseInt(german[1], 10), unit };
}

export function relativePublishedAt(published: PublishedAgo, now = new Date()): string {
  const date = new Date(now);
  const value = Math.max(0, published.value);
  if (published.unit === "year") date.setUTCFullYear(date.getUTCFullYear() - value);
  else if (published.unit === "month") date.setUTCMonth(date.getUTCMonth() - value);
  else {
    const seconds = value * ({ second: 1, minute: 60, hour: 3600, day: 86400, week: 604800 } as const)[published.unit];
    date.setTime(date.getTime() - seconds * 1000);
  }
  return date.toISOString();
}

const searchCache = new Map<string, { at: number; data: { results: SearchResult[]; channels: ChannelSearchResult[] } }>();
const SEARCH_TTL = 5 * 60_000;

export async function searchYouTube(query: string): Promise<{ results: SearchResult[]; channels: ChannelSearchResult[] }> {
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
      title: decodeHtmlEntities(r.title?.runs?.[0]?.text ?? r.title?.simpleText ?? ""),
      thumbnail: r.thumbnail?.thumbnails?.at(-1)?.url ?? `https://i.ytimg.com/vi/${r.videoId}/hqdefault.jpg`,
      duration: r.lengthText?.simpleText ?? "",
      channelTitle: decodeHtmlEntities(r.shortBylineText?.runs?.[0]?.text ?? ""),
      channelAvatar: r.channelThumbnailSupportedRenderers?.channelThumbnailWithLinkRenderer
        ?.thumbnail?.thumbnails?.at(-1)?.url ?? null,
      viewCount: Number.isFinite(viewNum) && viewNum > 0 ? viewNum : null,
      published: parsePublishedTimeText(r.publishedTimeText?.simpleText),
    });
  }
  const channels: ChannelSearchResult[] = [];
  for (const r of deepCollect(data, "channelRenderer")) {
    if (!r?.channelId) continue;
    const metadata = [r.shortBylineText, r.subscriberCountText, r.videoCountText]
      .map((value) => String(value?.simpleText ?? value?.runs?.map((part: any) => part.text).join("") ?? ""));
    const rawThumbnail = r.thumbnail?.thumbnails?.at(-1)?.url ?? "";
    channels.push({
      channelId: r.channelId,
      title: decodeHtmlEntities(r.title?.simpleText ?? r.title?.runs?.[0]?.text ?? ""),
      thumbnail: rawThumbnail.startsWith("//") ? `https:${rawThumbnail}` : rawThumbnail,
      handle: metadata.find((text) => text.startsWith("@")) ?? "",
      subscriberCount: cleanSubscriberCount(metadata.find(isSubscriberText) ?? ""),
      videoCount: metadata.find(isVideoCountText) ?? "",
    });
  }
  const result = { results: out.slice(0, 20), channels: channels.slice(0, 10) };
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
  liveStatus: "none" | "live" | "upcoming";
}

export interface VideoCreatorInfo {
  channelId: string;
  title: string;
  avatar: string;
  handle: string;
  isOwner: boolean;
}

/** Parse YouTube's native multi-creator attribution dialog. This deliberately
 * ignores @mentions in descriptions: only channels explicitly attached by
 * YouTube count as collaborators. */
export function parseVideoCreatorsFromInitialData(data: any, ownerChannelId: string): VideoCreatorInfo[] {
  // `attributedTitle` and the dialog command are siblings in some watch-page
  // payloads and nested in others. Scan dialogs directly instead of depending
  // on that unstable wrapper shape.
  const dialogs = [
    ...deepCollect(data, "dialogViewModel"),
    ...deepCollect(data, "showDialogViewModel"),
  ];
  for (const dialog of dialogs) {
    const items = dialog?.customContent?.listViewModel?.listItems;
    if (!Array.isArray(items) || items.length < 2) continue;

    const creators: VideoCreatorInfo[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      const model = item?.listItemViewModel;
      const title = model?.title?.content;
      const channelId = deepCollect(model?.title, "browseEndpoint")[0]?.browseId
        ?? deepCollect(model?.leadingAccessory, "browseEndpoint")[0]?.browseId;
      if (typeof channelId !== "string" || !channelId.startsWith("UC") || seen.has(channelId) || typeof title !== "string" || !title) continue;
      seen.add(channelId);
      const sources = deepCollect(model?.leadingAccessory, "sources")
        .flat()
        .filter((source: any) => typeof source?.url === "string");
      const subtitle = typeof model?.subtitle?.content === "string" ? model.subtitle.content : "";
      const handleMatch = subtitle.match(/@([\p{L}\p{N}._-]+)/u);
      creators.push({
        channelId,
        title: decodeHtmlEntities(title),
        avatar: sources.at(-1)?.url ?? "",
        handle: handleMatch ? `@${handleMatch[1]}` : "",
        isOwner: channelId === ownerChannelId,
      });
    }
    if (creators.length > 1 && (!ownerChannelId || creators.some((creator) => creator.isOwner))) {
      if (!ownerChannelId) creators[0].isOwner = true;
      return creators;
    }
  }
  return [];
}

export function parseVideoCreatorsFromHtml(html: string): VideoCreatorInfo[] {
  const player = extractVariable(html, "ytInitialPlayerResponse");
  const ownerChannelId = player?.videoDetails?.channelId
    ?? player?.microformat?.playerMicroformatRenderer?.externalChannelId
    ?? "";
  return parseVideoCreatorsFromInitialData(extractInitialData(html), ownerChannelId);
}

export async function fetchVideoCreators(videoId: string): Promise<VideoCreatorInfo[]> {
  const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, { headers: FETCH_HEADERS });
  if (!res.ok) throw new Error(`YouTube creators fetch failed (${res.status})`);
  return parseVideoCreatorsFromHtml(await res.text());
}

const videoInfoCache = new Map<string, { at: number; data: VideoInfo }>();
const VIDEO_INFO_TTL = 10 * 60_000;

function videoInfoFromPlayerResponse(videoId: string, pr: any): VideoInfo {
  const vd = pr?.videoDetails;
  if (!vd?.videoId) {
    // Surface why YouTube withheld the video: a stripped player response with
    // playabilityStatus LOGIN_REQUIRED + "confirm you're not a bot" means the
    // server's egress IP is bot-flagged (VPN/WARP/datacenter), not a bug here.
    const ps = pr?.playabilityStatus;
    const reason = ps?.reason
      ?? ps?.errorScreen?.playerErrorMessageRenderer?.reason?.simpleText;
    const detail = pr == null
      ? "no player response"
      : [ps?.status, reason].filter(Boolean).join(": ") || "no playabilityStatus";
    throw new Error(`videoDetails missing (${detail})`);
  }

  const mf = pr?.microformat?.playerMicroformatRenderer;
  const lengthSec = parseInt(vd.lengthSeconds ?? "", 10);
  const duration = Number.isFinite(lengthSec) && lengthSec > 0
    ? `${Math.floor(lengthSec / 60)}:${String(lengthSec % 60).padStart(2, "0")}`
    : null;
  const scheduledStart = pr?.playabilityStatus?.liveStreamability?.liveStreamabilityRenderer
    ?.offlineSlate?.liveStreamOfflineSlateRenderer?.scheduledStartTime;
  const liveStatus: VideoInfo["liveStatus"] = vd.isLive === true
    ? "live"
    : scheduledStart || pr?.playabilityStatus?.status === "LIVE_STREAM_OFFLINE"
      ? "upcoming"
      : "none";

  return {
    videoId: vd.videoId,
    title: decodeHtmlEntities(vd.title ?? ""),
    channelId: vd.channelId ?? mf?.externalChannelId ?? "",
    channelTitle: decodeHtmlEntities(vd.author ?? mf?.ownerChannelName ?? ""),
    description: vd.shortDescription ?? "",
    thumbnail: vd.thumbnail?.thumbnails?.at(-1)?.url
      ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    viewCount: parseInt(vd.viewCount ?? "", 10) || null,
    publishedAt: mf?.publishDate ?? null,
    duration,
    liveStatus,
  };
}

async function fetchVideoInfoFromInnerTube(videoId: string): Promise<VideoInfo> {
  const data = await _yt.player({ videoId });
  return videoInfoFromPlayerResponse(videoId, data);
}

async function fetchVideoInfoFromEmbed(videoId: string): Promise<VideoInfo> {
  const res = await fetch(`https://www.youtube.com/embed/${videoId}`, { headers: FETCH_HEADERS });
  if (!res.ok) throw new Error(`YouTube embed fetch failed (${res.status})`);
  const pr = extractVariable(await res.text(), "ytInitialPlayerResponse");
  return videoInfoFromPlayerResponse(videoId, pr);
}

export async function fetchVideoInfo(videoId: string): Promise<VideoInfo> {
  const cached = videoInfoCache.get(videoId);
  if (cached && Date.now() - cached.at < VIDEO_INFO_TTL) return cached.data;

  let result: VideoInfo;
  try {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const res = await fetch(url, { headers: FETCH_HEADERS });
    if (!res.ok) throw new Error(`YouTube fetch failed (${res.status})`);
    const html = await res.text();
    const pr = extractVariable(html, "ytInitialPlayerResponse");
    result = videoInfoFromPlayerResponse(videoId, pr);
  } catch (htmlError) {
    try {
      result = await fetchVideoInfoFromInnerTube(videoId);
    } catch (innerTubeError) {
      try {
        result = await fetchVideoInfoFromEmbed(videoId);
      } catch (embedError) {
        const primary = htmlError instanceof Error ? htmlError.message : String(htmlError);
        const fallback = innerTubeError instanceof Error ? innerTubeError.message : String(innerTubeError);
        const embed = embedError instanceof Error ? embedError.message : String(embedError);
        throw new Error(`video info failed: html=${primary}; innertube=${fallback}; embed=${embed}`);
      }
    }
  }
  videoInfoCache.set(videoId, { at: Date.now(), data: result });
  return result;
}

/** Fetch only the exact publish date without requiring a playable video. */
export async function fetchVideoPublishedAt(videoId: string): Promise<string | null> {
  const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, { headers: FETCH_HEADERS });
  if (!res.ok) return null;
  const html = await res.text();
  const playerDate = extractVariable(html, "ytInitialPlayerResponse")
    ?.microformat?.playerMicroformatRenderer?.publishDate;
  const raw = typeof playerDate === "string" ? playerDate
    : html.match(/"publishDate":"([^"]+)"/)?.[1]
      ?? html.match(/"uploadDate":"([^"]+)"/)?.[1]
      ?? html.match(/itemprop="datePublished" content="([^"]+)"/)?.[1];
  if (!raw || !/^\d{4}-\d{2}-\d{2}/.test(raw)) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
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
      if (m) result.push({ channelId: m[1], title: decodeHtmlEntities(outline["@_title"] ?? outline["@_text"] ?? "") });
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
    result.push({ channelId: m[1], title: decodeHtmlEntities(cols.length >= 3 ? cols.slice(2).join(",").trim() : "") });
  }
  return result;
}
