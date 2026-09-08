import { isYouTubeRateLimitError } from "./youtubeRateLimit";
import { parsePublishedTimeText, relativePublishedAt } from "./youtube";
import { resolveYouTubeLanguage, youtubeRequestHeaders, type ResolvedYouTubeLanguage } from "./youtubeRequestLanguage";
import { readYouTubeResponseWithCookies } from "./youtubeCookieJar";

const POSTS_TTL_MS = 30 * 60 * 1000;
const MAX_CONTINUATION_PAGES = 4;

export interface ChannelPostImage { url: string; width: number | null; height: number | null }
export interface ChannelPostAttachment {
  type: "video" | "playlist" | "poll";
  id: string | null;
  title: string;
  thumbnail: string | null;
  choices?: Array<{ text: string; votes: string | null }>;
}
export interface ChannelPost {
  id: string;
  authorName: string;
  authorAvatar: string;
  text: string;
  publishedAt: string | null;
  publishedText: string;
  likeCount: string;
  replyCount: string;
  images: ChannelPostImage[];
  attachment: ChannelPostAttachment | null;
  url: string;
}

interface PostsCacheEntry { at: number; posts: ChannelPost[] }
const postsCache = new Map<string, PostsCacheEntry>();
const inFlight = new Map<string, Promise<PostsCacheEntry>>();

function requestHeaders(language: ResolvedYouTubeLanguage) {
  return youtubeRequestHeaders(language.userId, language);
}

function extractInitialData(html: string): any | null {
  const marker = "var ytInitialData = ";
  const start = html.indexOf(marker);
  if (start < 0) return null;
  const jsonStart = start + marker.length;
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let i = jsonStart; i < html.length; i++) {
    const char = html[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"') { quote = char; continue; }
    if (char === "{") depth++;
    if (char === "}" && --depth === 0) {
      try { return JSON.parse(html.slice(jsonStart, i + 1)); } catch { return null; }
    }
  }
  return null;
}

function deepCollect(node: any, key: string, out: any[] = []): any[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const item of node) deepCollect(item, key, out);
    return out;
  }
  for (const [name, value] of Object.entries(node)) {
    if (name === key) out.push(value);
    deepCollect(value, key, out);
  }
  return out;
}

function text(value: any): string {
  if (typeof value?.simpleText === "string") return value.simpleText;
  if (Array.isArray(value?.runs)) return value.runs.map((run: any) => String(run?.text ?? "")).join("");
  return "";
}

function absoluteUrl(url: string): string {
  return url.startsWith("//") ? `https:${url}` : url;
}

function imageFrom(renderer: any): ChannelPostImage | null {
  const source = renderer?.image?.thumbnails?.at(-1);
  return typeof source?.url === "string" ? {
    url: absoluteUrl(source.url),
    width: Number.isFinite(source.width) ? source.width : null,
    height: Number.isFinite(source.height) ? source.height : null,
  } : null;
}

function thumbnail(renderer: any): string | null {
  const sources = renderer?.thumbnail?.thumbnails ?? renderer?.thumbnails;
  const source = Array.isArray(sources) ? sources.at(-1) : null;
  return typeof source?.url === "string" ? absoluteUrl(source.url) : null;
}

function parseAttachment(root: any): { images: ChannelPostImage[]; attachment: ChannelPostAttachment | null } {
  const images = deepCollect(root, "backstageImageRenderer")
    .map(imageFrom)
    .filter((value): value is ChannelPostImage => value !== null);
  const video = deepCollect(root, "videoRenderer")[0];
  if (video?.videoId) return { images, attachment: { type: "video", id: video.videoId, title: text(video.title), thumbnail: thumbnail(video) } };
  const playlist = deepCollect(root, "playlistRenderer")[0];
  if (playlist?.playlistId) return { images, attachment: { type: "playlist", id: playlist.playlistId, title: text(playlist.title), thumbnail: thumbnail(playlist) } };
  const poll = deepCollect(root, "pollRenderer")[0] ?? deepCollect(root, "backstagePollRenderer")[0];
  if (poll) {
    const choices = (poll.choices ?? []).map((choice: any) => ({
      text: text(choice?.text ?? choice?.choiceText),
      votes: text(choice?.votePercentage ?? choice?.voteRatio) || null,
    })).filter((choice: { text: string }) => choice.text);
    return { images, attachment: { type: "poll", id: null, title: text(poll.question), thumbnail: null, choices } };
  }
  return { images, attachment: null };
}

export function parseChannelPosts(data: any, now = new Date()): ChannelPost[] {
  const seen = new Set<string>();
  const posts: ChannelPost[] = [];
  for (const renderer of deepCollect(data, "backstagePostRenderer")) {
    const id = typeof renderer?.postId === "string" ? renderer.postId : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const { images, attachment } = parseAttachment(renderer.backstageAttachment);
    const publishedText = text(renderer.publishedTimeText);
    const published = parsePublishedTimeText(publishedText);
    posts.push({
      id,
      authorName: text(renderer.authorText),
      authorAvatar: thumbnail(renderer.authorThumbnail) ?? "",
      text: text(renderer.contentText),
      publishedAt: published ? relativePublishedAt(published, now) : null,
      publishedText,
      likeCount: text(renderer.voteCount),
      replyCount: text(renderer.actionButtons?.commentActionButtonsRenderer?.replyButton?.buttonRenderer?.text),
      images,
      attachment,
      url: `https://www.youtube.com/post/${encodeURIComponent(id)}`,
    });
  }
  return posts;
}

function continuationToken(data: any): string | null {
  for (const renderer of deepCollect(data, "continuationItemRenderer")) {
    const token = renderer?.continuationEndpoint?.continuationCommand?.token;
    if (typeof token === "string" && token) return token;
  }
  return null;
}

function innertubeConfig(html: string): { apiKey: string; clientVersion: string } | null {
  const apiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1];
  const clientVersion = html.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/)?.[1];
  return apiKey && clientVersion ? { apiKey, clientVersion } : null;
}

async function fetchContinuation(token: string, config: { apiKey: string; clientVersion: string }, language: ResolvedYouTubeLanguage): Promise<any> {
  const url = `https://www.youtube.com/youtubei/v1/browse?prettyPrint=false&key=${encodeURIComponent(config.apiKey)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { ...requestHeaders(language), "Content-Type": "application/json", Origin: "https://www.youtube.com" },
    body: JSON.stringify({ context: { client: { clientName: "WEB", clientVersion: config.clientVersion, hl: language.hl, gl: "US" } }, continuation: token }),
  });
  return JSON.parse(await readYouTubeResponseWithCookies(response, "posts continuation fetch failed", language.userId, url));
}

async function fetchFresh(channelId: string, language: ResolvedYouTubeLanguage): Promise<PostsCacheEntry> {
  const url = `https://www.youtube.com/channel/${encodeURIComponent(channelId)}/posts?hl=${encodeURIComponent(language.hl)}`;
  const response = await fetch(url, { headers: requestHeaders(language) });
  const html = await readYouTubeResponseWithCookies(response, "posts fetch failed", language.userId, url);
  const data = extractInitialData(html);
  const posts = parseChannelPosts(data);
  const seen = new Set(posts.map((post) => post.id));
  const config = innertubeConfig(html);
  let token = continuationToken(data);
  for (let page = 0; config && token && page < MAX_CONTINUATION_PAGES; page++) {
    const previous = token;
    try {
      const continuation = await fetchContinuation(token, config, language);
      for (const post of parseChannelPosts(continuation)) if (!seen.has(post.id)) { seen.add(post.id); posts.push(post); }
      token = continuationToken(continuation);
      if (token === previous) break;
    } catch (error) {
      if (isYouTubeRateLimitError(error)) throw error;
      break;
    }
  }
  const entry = { at: Date.now(), posts };
  return entry;
}

export async function fetchChannelPosts(channelId: string, force = false, userId?: number): Promise<{ posts: ChannelPost[]; fetchedAt: string; cached: boolean }> {
  const language = resolveYouTubeLanguage(userId);
  const cacheKey = `${language.cacheKey}:${channelId}`;
  const cached = postsCache.get(cacheKey);
  if (!force && cached && Date.now() - cached.at < POSTS_TTL_MS) {
    return { posts: cached.posts, fetchedAt: new Date(cached.at).toISOString(), cached: true };
  }
  let pending = inFlight.get(cacheKey);
  if (!pending || force) {
    pending = fetchFresh(channelId, language).then((entry) => { postsCache.set(cacheKey, entry); return entry; }).finally(() => inFlight.delete(cacheKey));
    inFlight.set(cacheKey, pending);
  }
  const fresh = await pending;
  return { posts: fresh.posts, fetchedAt: new Date(fresh.at).toISOString(), cached: false };
}
