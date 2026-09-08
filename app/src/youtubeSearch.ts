import { decodeHtmlEntities } from "./htmlEntities";
import type { ChannelSearchResult, PublishedAgo, SearchResult } from "./youtube";
import { readYouTubeResponseWithCookies } from "./youtubeCookieJar";

interface YoutubeSearchDependencies {
  requestHeaders: (userId?: number) => Record<string, string>;
  resolveCacheKey: (userId?: number) => string;
  cleanSubscriberCount: (text: string) => string;
  deepCollect: (node: any, key: string, out?: any[]) => any[];
  extractInitialData: (html: string) => any | null;
  isSubscriberText: (text: string) => boolean;
  isVideoCountText: (text: string) => boolean;
  isViewCountText: (text: string) => boolean;
  parsePublishedTimeText: (text: string | undefined) => PublishedAgo | null;
}

/**
 * Parse an abbreviated or full view/subscriber count returned by YouTube.
 * Handles locale-specific formats: "4.7M", "4,7 M" (fr/de comma-as-decimal),
 * "4.700.000" (European dot-as-thousands), "4,700,000" (US comma-as-thousands),
 * and word suffixes "mln", "tys.", "Mio.", "Mrd.".
 */
export function parseAbbreviatedCount(text: string): number | null {
  // Abbreviated: number with optional decimal part followed by a letter/word suffix.
  // Accepts both comma ("4,7 M") and dot ("4.7M") as the decimal separator.
  const abbr = text.match(/([\d]+(?:[.,][\d]+)?)\s*([KkMmBb]|mln\.?|tys\.?|Mio\.?|Mrd\.?)\b/);
  if (abbr) {
    const value = parseFloat(abbr[1].replace(",", "."));
    if (!Number.isFinite(value)) return null;
    const suffix = abbr[2].toLowerCase().replace(/\.$/, "");
    const multiplierMap: Record<string, number> = {
      k: 1e3, m: 1e6, b: 1e9,
      mln: 1e6, tys: 1e3, mio: 1e6, mrd: 1e9,
    };
    const total = Math.round(value * (multiplierMap[suffix] ?? 1));
    return total > 0 ? total : null;
  }

  // Full number with thousands separators: "4,700,000" or "4.700.000" or "12345".
  const full = text.match(/\d[\d,.]*\d|\d/)?.[0];
  if (!full) return null;
  // European style "4.700.000" — groups of exactly three digits separated by dots.
  if (/^\d{1,3}(?:\.\d{3})+$/.test(full)) {
    const v = parseInt(full.replace(/\./g, ""), 10);
    return v > 0 ? v : null;
  }
  // Standard style — strip commas/spaces used as thousands separators.
  const v = parseInt(full.replace(/[, ]/g, ""), 10);
  return Number.isFinite(v) && v > 0 ? v : null;
}

export function createYoutubeSearch(dependencies: YoutubeSearchDependencies) {
  const {
    requestHeaders,
    resolveCacheKey,
    cleanSubscriberCount,
    deepCollect,
    extractInitialData,
    isSubscriberText,
    isVideoCountText,
    isViewCountText,
    parsePublishedTimeText,
  } = dependencies;

const searchCache = new Map<string, { at: number; data: { results: SearchResult[]; channels: ChannelSearchResult[] } }>();
const SEARCH_TTL = 5 * 60_000;

/** Flatten every text part across a lockup's metadata rows. */
function lockupMetadataParts(vm: any): any[] {
  const rows = vm?.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows ?? [];
  return rows.flatMap((row: any) => row?.metadataParts ?? []);
}

function bestSourceUrl(node: any): string {
  const group = deepCollect(node, "sources").find((sources: any) => Array.isArray(sources) && sources.some((source) => source?.url));
  return group?.at(-1)?.url ?? "";
}

// YouTube migrated search results from videoRenderer/channelRenderer to
// lockupViewModel cards; these read the new shape so results don't vanish when
// the (A/B-tested) new layout is served.
function searchVideoFromLockup(vm: any): SearchResult | null {
  if (vm?.contentType !== "LOCKUP_CONTENT_TYPE_VIDEO" || !vm?.contentId) return null;
  const metadata = vm?.metadata?.lockupMetadataViewModel;
  const title = metadata?.title?.content;
  if (!title) return null;
  const parts = lockupMetadataParts(vm);
  const channelPart = parts.find((part: any) =>
    String(part?.text?.commandRuns?.[0]?.onTap?.innertubeCommand?.browseEndpoint?.browseId ?? "").startsWith("UC"));
  const viewPart = parts.find((part: any) => isViewCountText(String(part?.text?.content ?? "")));
  const published = parts
    .map((part: any) => parsePublishedTimeText(String(part?.text?.content ?? "")))
    .find((value: PublishedAgo | null) => value) ?? null;
  const badges = deepCollect(vm?.contentImage, "thumbnailBadgeViewModel").map((badge: any) => String(badge?.text ?? ""));
  return {
    videoId: vm.contentId,
    title: decodeHtmlEntities(title),
    thumbnail: bestSourceUrl(vm?.contentImage) || `https://i.ytimg.com/vi/${vm.contentId}/hqdefault.jpg`,
    duration: badges.find((text: string) => /^\d+(?::\d+)+$/.test(text)) ?? "",
    channelId: String(channelPart?.text?.commandRuns?.[0]?.onTap?.innertubeCommand?.browseEndpoint?.browseId ?? ""),
    channelTitle: decodeHtmlEntities(channelPart?.text?.content ?? ""),
    channelAvatar: bestSourceUrl(metadata?.image) || null,
    viewCount: viewPart ? parseAbbreviatedCount(String(viewPart.text.content)) : null,
    published,
  };
}

function searchChannelFromLockup(vm: any): ChannelSearchResult | null {
  if (!String(vm?.contentType ?? "").includes("CHANNEL")) return null;
  const channelId = String(vm?.contentId ?? "").startsWith("UC")
    ? vm.contentId
    : deepCollect(vm, "browseEndpoint").map((b: any) => b?.browseId).find((id: any) => typeof id === "string" && id.startsWith("UC"));
  if (!channelId) return null;
  const metadata = vm?.metadata?.lockupMetadataViewModel;
  const parts = lockupMetadataParts(vm).map((part: any) => String(part?.text?.content ?? ""));
  const rawThumbnail = bestSourceUrl(vm);
  return {
    channelId,
    title: decodeHtmlEntities(metadata?.title?.content ?? ""),
    thumbnail: rawThumbnail.startsWith("//") ? `https:${rawThumbnail}` : rawThumbnail,
    handle: parts.find((text) => text.startsWith("@")) ?? "",
    subscriberCount: cleanSubscriberCount(parts.find(isSubscriberText) ?? ""),
    videoCount: parts.find(isVideoCountText) ?? "",
  };
}

function collectSearchVideos(data: any): SearchResult[] {
  const out: SearchResult[] = [];
  const seen = new Set<string>();
  for (const r of deepCollect(data, "videoRenderer")) {
    if (!r?.videoId || seen.has(r.videoId)) continue;
    seen.add(r.videoId);
    const viewStr = r?.viewCountText?.simpleText ?? r?.viewCountText?.runs?.[0]?.text ?? "";
    const owner = r.ownerText ?? r.shortBylineText;
    out.push({
      videoId: r.videoId,
      title: decodeHtmlEntities(r.title?.runs?.[0]?.text ?? r.title?.simpleText ?? ""),
      thumbnail: r.thumbnail?.thumbnails?.at(-1)?.url ?? `https://i.ytimg.com/vi/${r.videoId}/hqdefault.jpg`,
      duration: r.lengthText?.simpleText ?? "",
      channelId: String(owner?.runs?.find((part: any) => part?.navigationEndpoint?.browseEndpoint?.browseId)?.navigationEndpoint?.browseEndpoint?.browseId ?? ""),
      channelTitle: decodeHtmlEntities(owner?.runs?.[0]?.text ?? ""),
      channelAvatar: r.channelThumbnailSupportedRenderers?.channelThumbnailWithLinkRenderer
        ?.thumbnail?.thumbnails?.at(-1)?.url ?? null,
      viewCount: viewStr ? parseAbbreviatedCount(viewStr) : null,
      published: parsePublishedTimeText(r.publishedTimeText?.simpleText),
    });
  }
  for (const vm of deepCollect(data, "lockupViewModel")) {
    const video = searchVideoFromLockup(vm);
    if (video && !seen.has(video.videoId)) {
      seen.add(video.videoId);
      out.push(video);
    }
  }
  return out;
}

function collectSearchChannels(data: any): ChannelSearchResult[] {
  const channels: ChannelSearchResult[] = [];
  const seen = new Set<string>();
  for (const r of deepCollect(data, "channelRenderer")) {
    if (!r?.channelId || seen.has(r.channelId)) continue;
    seen.add(r.channelId);
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
  for (const vm of deepCollect(data, "lockupViewModel")) {
    const channel = searchChannelFromLockup(vm);
    if (channel && !seen.has(channel.channelId)) {
      seen.add(channel.channelId);
      channels.push(channel);
    }
  }
  return channels;
}

async function fetchSearchData(query: string, filter = "", userId?: number): Promise<any | null> {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}${filter}`;
  const res = await fetch(url, { headers: requestHeaders(userId) });
  return extractInitialData(await readYouTubeResponseWithCookies(res, "YouTube search failed", userId, url));
}

// YouTube's "Channel" search filter (sp=EgIQAg%3D%3D). The default results page
// increasingly leads with video cards and omits the channel entirely, so we
// re-query with this filter when no channel surfaced.
const SEARCH_CHANNEL_FILTER = "&sp=EgIQAg%3D%3D";

async function searchYouTube(query: string, userId?: number): Promise<{ results: SearchResult[]; channels: ChannelSearchResult[] }> {
  const cacheKey = `${resolveCacheKey(userId)}:${query}`;
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.at < SEARCH_TTL) return cached.data;

  const data = await fetchSearchData(query, "", userId);
  if (!data) throw new Error("YouTube search returned no data (bot challenge or layout change)");

  const results = collectSearchVideos(data);
  let channels = collectSearchChannels(data);

  // The default layout often drops the channel card for channel-name queries;
  // a channel-filtered follow-up reliably brings it back.
  if (channels.length === 0) {
    try {
      const channelData = await fetchSearchData(query, SEARCH_CHANNEL_FILTER, userId);
      if (channelData) channels = collectSearchChannels(channelData);
    } catch {
      // Keep the (empty) channel list rather than failing the whole search.
    }
  }

  const result = { results: results.slice(0, 20), channels: channels.slice(0, 10) };
  searchCache.set(cacheKey, { at: Date.now(), data: result });
  return result;
}

  return { collectSearchVideos, searchChannelFromLockup, searchVideoFromLockup, searchYouTube };
}
