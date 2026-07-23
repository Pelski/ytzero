import type { I18nKey } from "./i18n";
import { decodeApiTitles } from "./htmlEntities";

// YouTube-supported playback rates, shared by the settings, watch and channel UIs.
export const PLAYBACK_SPEEDS = ["0.25", "0.5", "0.75", "1", "1.25", "1.5", "1.75", "2"] as const;

export interface Tag {
  id: number;
  name: string;
  color: string;
  filter_only?: number;
  source?: "manual" | "auto" | "channel";
  video_count?: number;
  channel_count?: number;
}

export interface Video {
  video_id: string;
  channel_id: string;
  title: string;
  description: string;
  thumbnail: string;
  published_at: string | null;
  published_at_approximate: number;
  members_only: number;
  live_status: "none" | "upcoming" | "live" | "was_live";
  status: "inbox" | "queued" | "archived";
  bucket: Bucket | null;
  show_from: string | null;
  is_short: number | null;
  views: number | null;
  likes: number | null;
  duration: string | null;
  watch_position: number | null;
  watch_duration: number | null;
  channel_playback_speed?: string | null;
  channel_caption_mode?: "off" | "language" | null;
  channel_caption_language?: string | null;
  in_history: number;
  external?: number;
  liked: number | null;
  watched: number | null;
  channel_title: string;
  channel_thumbnail: string | null;
  channel_subscriber_count: string | null;
  download_status?: DownloadStatus | null;
  downloads_enabled?: boolean;
  downloads_allowed?: boolean;
  download_progress?: number | null;
  tags: Tag[];
  history_id?: number;
  watched_at?: string;
  source_playlist_title?: string | null;
  source_playlist_id?: string | null;
}

export type MembersOnlyVisibility = "default" | "everywhere" | "channel" | "hidden";

export interface Channel {
  channel_id: string;
  title: string;
  original_title?: string;
  custom_title?: string | null;
  url: string;
  thumbnail: string;
  subscriber_count?: string | null;
  handle?: string;
  description?: string;
  followed?: number;
  playback_speed?: string | null;
  caption_mode?: "off" | "language" | null;
  caption_language?: string | null;
  hide_members_only_from_feed?: number | null;
  hide_members_only_on_channel?: number | null;
  members_only_visibility?: MembersOnlyVisibility;
  auto_download_min_duration_override?: number | null;
  subscribed_at?: string | null;
  latest_video_at?: string | null;
  video_count?: number;
  tags: Tag[];
}

export interface Rule {
  id: number;
  tag_id: number;
  pattern: string;
  match_type: "contains" | "regex";
  field: "title" | "description" | "both";
  tag_name: string;
  tag_color: string;
}

export interface FilterRule {
  id: number;
  pattern: string;
  match_type: "contains" | "regex";
  field: "title" | "description" | "both";
  action: "reject" | "whitelist";
  channel_id: string | null;
  channel_title: string | null;
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
  /** Real video/short counts from our DB (independent of UI pagination). */
  counts?: { videos: number; shorts: number; processing: number };
}

export interface PlaylistInfo {
  playlistId: string;
  title: string;
  thumbnail: string;
  videoCount: string;
  followed?: boolean;
}

export interface FollowedPlaylist {
  playlist_id: string;
  title: string;
  thumbnail: string;
  video_count: string;
  last_synced_at: string | null;
  channel_id: string;
  channel_title: string;
  channel_thumbnail: string | null;
  followed_at?: string;
  include_in_feed?: number;
  followed?: number;
}

export interface FollowedPlaylistUpdates extends FollowedPlaylist {
  new_video_count: number;
  new_videos: Video[];
}

export interface VideoChannelPlaylist extends PlaylistInfo {
  channelId: string;
  channelTitle: string;
}

export interface VideoCreator {
  channelId: string;
  title: string;
  avatar: string;
  subscriberCount: string;
  handle: string;
  isOwner: boolean;
}

export interface PlaylistVideo {
  videoId: string;
  title: string;
  thumbnail: string;
  channelTitle: string;
  duration: string;
  index: number;
  watched: number;
  watch_position: number | null;
  watch_duration: number | null;
}

export interface UserPlaylist {
  id: number;
  name: string;
  icon: string;
  sort_order: number;
  video_count: number;
  has_video?: 0 | 1;
}

export interface UserPlaylistRule {
  id: number;
  playlist_id: number;
  pattern: string;
  match_type: "contains" | "regex";
  field: "title" | "description" | "both";
}

export interface AppSettings {
  language: "en" | "pl" | "de";
  show_shorts: string;
  player_hl: string;
  player_cc: string;
  player_cc_lang: string;
  player_sub_size: string;
  player_sub_color: string;
  player_sub_bg: string;
  player_quality: string;
  player_speed: string;
  keyboard_seek_seconds: string;
  auto_fullscreen_landscape?: string;
  grid_size: string;
  child_lock_enabled: string;
  app_name: string;
  app_icon_color: string;
  shorts_tab: string;
  show_top_channels: string;
  hide_live_from_feed: string;
  hide_members_only_from_feed: string;
  hide_members_only_on_channel: string;
  watched_style: string;
  sidebar_nav: string;
  sponsorblock_enabled: string;
  sponsorblock_categories: string;
  update_check_interval: string;
}

export interface AppNotification {
  id: number;
  kind: "app_update" | string;
  payload: {
    version?: string;
    url?: string;
    publishedAt?: string;
    videoId?: string;
    videoTitle?: string;
    thumbnail?: string;
    playlistId?: string;
    playlistTitle?: string;
    channelTitle?: string;
    channelThumbnail?: string;
  };
  target: string;
  read_at: string | null;
  created_at: string;
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
  watched: number;
  watch_position: number | null;
  watch_duration: number | null;
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

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  route: string;
  icon: string;
  permissions: string[];
  enabled: boolean;
}

export type PluginSettingValue = number | string;

export interface PluginSettingDef {
  key: string;
  label: string;
  description: string;
  type: "slider" | "select" | "toggle" | "text" | "multiselect";
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  defaultValue: PluginSettingValue;
}

export interface PluginTermState {
  lastTerms: string[];
  blockedTerms: string[];
}

export interface PluginSettingsResponse {
  definitions: PluginSettingDef[];
  settings: Record<string, PluginSettingValue>;
  terms?: PluginTermState;
}

export interface VideoSubtitle {
  lang: string;
  url: string;
}

export type DownloadStatus = "queued" | "downloading" | "done" | "error";

export interface DownloadItem {
  video_id: string;
  status: DownloadStatus;
  source: "manual" | "scheduled" | "feed";
  quality: string | null;
  size_bytes: number | null;
  error: string | null;
  attempts: number;
  pinned: number;
  created_at: string;
  finished_at: string | null;
  title: string;
  thumbnail: string;
  duration: string | null;
  is_short: number | null;
  published_at: string | null;
  channel_id: string;
  channel_title: string;
}

export interface DownloadsResponse {
  enabled: boolean;
  ytdlp_version: string | null;
  stats: { files: number; bytes: number; queued: number; cap_bytes: number };
  active: { video_id: string; percent: number; total_bytes: number | null; speed: string | null } | null;
  downloads: DownloadItem[];
}

export interface VideoDownload {
  video_id: string;
  status: DownloadStatus;
  quality: string | null;
  size_bytes: number | null;
  error: string | null;
  pinned: number;
}

export type DiscoveryRecommendation =
  | { kind: "local"; score: number; reasons: string[]; video: Video; query?: string }
  | { kind: "external"; score: number; reasons: string[]; result: SearchResult; query: string };

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

export interface SponsorSegment {
  category: string;
  actionType: string;
  segment: [number, number];
  UUID: string;
}

export interface VideoChapter {
  title: string;
  start: number;
}

// Labels live in the i18n locale files (keys "sbCat*"); here we only keep the
// stable id, the i18n key to render, and the SponsorBlock color.
export const SB_CATEGORIES: { id: string; labelKey: I18nKey; color: string }[] = [
  { id: "sponsor",        labelKey: "sbCatSponsor",       color: "#00d400" },
  { id: "selfpromo",      labelKey: "sbCatSelfpromo",     color: "#ffff00" },
  { id: "interaction",    labelKey: "sbCatInteraction",   color: "#cc00ff" },
  { id: "intro",          labelKey: "sbCatIntro",         color: "#00ffff" },
  { id: "outro",          labelKey: "sbCatOutro",         color: "#0202ed" },
  { id: "preview",        labelKey: "sbCatPreview",       color: "#008fd6" },
  { id: "music_offtopic", labelKey: "sbCatMusicOfftopic", color: "#ff9900" },
  { id: "filler",         labelKey: "sbCatFiller",        color: "#7300ab" },
];

export interface ChildLockStatus {
  enabled: boolean;
  locked: boolean;
}

export interface Profile {
  id: number;
  name: string;
  avatar: string;
  avatar_color: string;
  has_pin: boolean;
  active: boolean;
  is_primary: boolean;
  is_child: boolean;
  pin_locked: boolean;
  child_config: ChildConfig | null;
  child_status: {
    remaining_seconds: number | null;
    unlimited_today: boolean;
  } | null;
  can_switch: boolean;
}

export interface ChildConfig {
  limit_minutes: number;
  local_only: boolean;
  hide_shorts: boolean;
  hide_live: boolean;
  downloads_only: boolean;
}

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

export interface ChildNowWatching {
  user_id: number;
  name: string;
  avatar: string;
  avatar_color: string;
  video_id: string;
  title: string;
  thumbnail: string;
  channel_id: string;
  channel_title: string;
  channel_thumbnail: string | null;
  remaining_seconds: number | null;
  unlimited_today: boolean;
}

export type ChildGrant = "15m" | "1h" | "video_end" | "today_off";

export interface ChildTimeRequest {
  id: number;
  user_id: number;
  video_id: string | null;
  created_at: string;
  name: string;
  avatar: string;
  avatar_color: string;
  requires_pin: boolean;
}

export type AuthMethod = "none" | "shared" | "per_profile" | "oidc" | "proxy_header";

export interface AuthStatus {
  method: AuthMethod;
  authenticated: boolean;
  can_switch: boolean;
  is_admin?: boolean;
  scope?: "account" | "profile" | null;
  oidc_mode?: "mapped" | "gateway";
  proxy_header_seen?: boolean;
  username_field?: boolean;
  login?: { password: boolean; passkey: boolean; oidc: boolean };
}

export interface AuthConfig {
  method: AuthMethod;
  shared: { username: string; password_set: boolean; passkeys: { id: number; label: string | null; created_at: string }[] };
  oidc: {
    issuer: string;
    client_id: string;
    client_secret_set: boolean;
    scopes: string;
    mode: "mapped" | "gateway";
    claim: string;
    autocreate: boolean;
    logout_url: string;
    groups_claim: string;
    admin_group: string;
    redirect_uri: string;
  };
  proxy: { header: string; logout_url: string; current_header_value: string };
  profiles: { id: number; name: string; username: string; has_password: boolean; has_passkey: boolean; oidc_subject: string; proxy_match: string }[];
}

export interface AuthConfigUpdate {
  shared?: { username?: string; password?: string };
  oidc?: Partial<AuthConfig["oidc"]> & { client_secret?: string };
  proxy?: { header?: string; logout_url?: string };
  profiles?: { id: number; username?: string; password?: string; oidc_subject?: string; proxy_match?: string }[];
}

export interface AppLogs {
  size: number;
  lines: string[];
  version: string;
  commit: string;
}

export interface AppVersion {
  version: string;
  commit: string;
}

export interface AppRelease {
  version: string;
  name: string;
  publishedAt: string;
  url: string;
  notes: string[];
}

export interface AppChangelog {
  releases: AppRelease[];
}

export interface UpdateCheck {
  currentVersion: string;
  commit: string;
  latestVersion: string | null;
  updateAvailable: boolean | null;
  checkedAt: string;
  latestUrl: string;
  publishedAt: string;
}

export type Bucket = "today" | "tonight" | "tomorrow" | "tomorrow_evening" | "weekend";

export const BUCKET_LABELS: Record<Bucket, string> = {
  today: "Dzisiaj",
  tonight: "Dziś wieczorem",
  tomorrow: "Jutro",
  tomorrow_evening: "Jutro wieczorem",
  weekend: "Weekend",
};

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: init?.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error ?? `HTTP ${res.status}`);
  }
  return decodeApiTitles(await res.json()) as T;
}

export interface InsightProfileRef {
  id: number;
  name: string;
  avatar: string;
  avatar_color: string;
  is_child: boolean;
}

export interface HouseholdInsights {
  range: { days: number; from: string; to: string };
  scope: { profile_id: number | null };
  available_profiles: InsightProfileRef[];
  summary: {
    total_seconds: number;
    daily_average_seconds: number;
    video_count: number;
    active_days: number;
    active_profiles: number;
    streak_days: number;
    previous_seconds: number;
    change_percent: number | null;
    favorite_hour: number | null;
    favorite_weekday: number | null;
    sponsorblock_saved_seconds: number;
  };
  daily: { day: string; seconds: number }[];
  hours: { hour: number; seconds: number }[];
  heatmap: { weekday: number; hours: { hour: number; seconds: number }[] }[];
  time_of_day: { key: "night" | "morning" | "afternoon" | "evening"; seconds: number }[];
  content: { key: "regular" | "shorts" | "live"; seconds: number }[];
  profiles: (InsightProfileRef & {
    seconds: number;
    video_count: number;
    share: number;
    top_channel: { channel_id: string; title: string; seconds: number } | null;
    top_tag: { name: string; color: string; seconds: number } | null;
  })[];
  channels: {
    channel_id: string;
    title: string;
    thumbnail: string;
    seconds: number;
    video_count: number;
    profile_count: number;
    profiles: { user_id: number; seconds: number }[];
  }[];
  tags: {
    name: string;
    color: string;
    seconds: number;
    video_count: number;
    profile_count: number;
    profiles: { user_id: number; seconds: number }[];
  }[];
  tag_rhythms: (InsightProfileRef & {
    tags: {
      name: string;
      seconds: number;
      peak_hour: number | null;
      hours: { hour: number; seconds: number }[];
    }[];
  })[];
  completion: {
    completed: number;
    in_progress: number;
    brief: number;
    total: number;
    average_percent: number;
  };
  completion_channels: {
    channel_id: string;
    title: string;
    thumbnail: string;
    completed: number;
    total: number;
    completion_percent: number;
  }[];
  regular_returns: {
    channels: { channel_id: string; title: string; thumbnail: string; active_days: number; seconds: number }[];
    tags: { name: string; color: string; active_days: number; seconds: number }[];
  };
  discoveries: {
    channels: { channel_id: string; title: string; thumbnail: string; first_day: string; seconds: number }[];
    tags: { name: string; color: string; first_day: string; seconds: number }[];
  };
  shared_interests: {
    channels: { channel_id: string; title: string; thumbnail: string; profile_count: number; seconds: number }[];
  };
  sponsorblock_categories: { category: string; seconds: number; skip_count: number }[];
}

export interface ImportManifest {
  sessionId: string;
  channels: { channelId: string; title: string }[];
  playlists: { name: string; videoCount: number }[];
  history: {
    total: number;
    undated: number;
    from: string | null;
    to: string | null;
    months: { month: string; count: number }[];
  };
}

export interface ImportCommitPayload {
  sessionId: string;
  channels?: { enabled: boolean; excludedIds?: string[] };
  playlists?: { enabled: boolean; excludedNames?: string[] };
  history?: { enabled: boolean; from?: string | null };
}

export interface ImportCommitResult {
  channelsAdded: number;
  playlistsCreated: number;
  playlistVideosAdded: number;
  historyAdded: number;
  watchedMarked: number;
  background: {
    enrichPending: number;
    enrichEstimateMin: number;
    channelRefreshEstimateMin: number;
  };
}

export const api = {
  feed: (p: {
    page?: number;
    tags?: number[];
    q?: string;
    channel?: string;
    status?: string;
    shorts?: boolean;
    only_shorts?: boolean;
    liked?: boolean;
    all_sources?: boolean;
    show_all?: boolean;
    processing?: boolean;
    limit?: number;
  }) => {
    const qs = new URLSearchParams();
    if (p.page) qs.set("page", String(p.page));
    if (p.tags?.length) qs.set("tags", p.tags.join(","));
    if (p.q) qs.set("q", p.q);
    if (p.channel) qs.set("channel", p.channel);
    if (p.status) qs.set("status", p.status);
    if (p.shorts !== undefined) qs.set("shorts", p.shorts ? "1" : "0");
    if (p.only_shorts) qs.set("only_shorts", "1");
    if (p.liked) qs.set("liked", "1");
    if (p.all_sources) qs.set("all_sources", "1");
    if (p.show_all) qs.set("show_all", "1");
    if (p.processing) qs.set("processing", "1");
    if (p.limit) qs.set("limit", String(p.limit));
    return http<{ videos: Video[] }>(`/feed?${qs}`);
  },
  inProgress: () => http<{ videos: Video[] }>("/in-progress"),
  youtubeSearch: (q: string) => http<{ results: SearchResult[]; channels: ChannelSearchResult[] }>(`/search/youtube?q=${encodeURIComponent(q)}`),
  plugins: () => http<{ plugins: PluginManifest[] }>("/plugins"),
  updatePlugin: (id: string, enabled: boolean) =>
    http<{ plugins: PluginManifest[] }>(`/plugins/${id}`, { method: "PUT", body: JSON.stringify({ enabled }) }),
  pluginSettings: (id: string) =>
    http<PluginSettingsResponse>(`/plugins/${id}/settings`),
  updatePluginSettings: (id: string, patch: Record<string, PluginSettingValue> | { blockedTerms: string[] }) =>
    http<PluginSettingsResponse>(`/plugins/${id}/settings`, { method: "PUT", body: JSON.stringify(patch) }),
  resetPlugin: (id: string) =>
    http<PluginSettingsResponse>(`/plugins/${id}/reset`, { method: "POST", body: "{}" }),
  downloadCookies: () => http<{ configured: boolean }>("/plugins/downloads/cookies"),
  uploadDownloadCookies: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return http<{ configured: boolean }>("/plugins/downloads/cookies", { method: "POST", body: fd });
  },
  removeDownloadCookies: () => http<{ configured: boolean }>("/plugins/downloads/cookies", { method: "DELETE" }),
  downloads: () => http<DownloadsResponse>("/downloads"),
  requestDownload: (id: string, priority = false) =>
    http<{ ok: true; download: VideoDownload | null }>(`/videos/${id}/download`, { method: "POST", body: JSON.stringify({ priority }) }),
  videoDownload: (id: string) =>
    http<{ download: VideoDownload | null; progress: { percent: number; total_bytes: number | null; speed: string | null } | null }>(`/videos/${id}/download`),
  removeDownload: (id: string) =>
    http<{ ok: true }>(`/videos/${id}/download`, { method: "DELETE" }),
  pinDownload: (id: string, pinned: boolean) =>
    http<{ ok: true; download: VideoDownload | null }>(`/videos/${id}/download/pin`, { method: "PUT", body: JSON.stringify({ pinned }) }),
  streamUrl: (id: string) => `/api/videos/${id}/stream`,
  videoSubtitles: (id: string) => http<{ subtitles: VideoSubtitle[] }>(`/videos/${id}/subtitles`),
  downloadSubtitle: (id: string, lang: string) =>
    http<{ ok: boolean; downloaded: boolean; subtitles: VideoSubtitle[] }>(`/videos/${id}/subtitles`, { method: "POST", body: JSON.stringify({ lang }) }),
  downloadFileUrl: (id: string) => `/api/videos/${id}/file`,
  discoveryRecommendations: (refresh = false) => http<{ enabled: boolean; recommendations: DiscoveryRecommendation[] }>(`/discovery/recommendations${refresh ? "?refresh=1" : ""}`),
  dismissDiscoveryRecommendation: (id: string) =>
    http<{ ok: true }>(`/discovery/recommendations/${id}/dismiss`, { method: "POST", body: "{}" }),
  videoInfo: (id: string) => http<{ info: VideoInfo }>(`/videos/${id}/info`),
  externalVideos: () => http<{ videos: Video[] }>("/external"),
  clearExternal: () => http<{ deleted: number }>("/external", { method: "DELETE" }),
  removeExternal: (id: string) => http<{ deleted: number }>(`/external/${id}`, { method: "DELETE" }),
  logs: (limit = 300) => http<AppLogs>(`/logs?limit=${limit}`),
  version: () => http<AppVersion>("/version"),
  changelog: async () => {
    const response = await fetch("/changelog.json");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json() as Promise<AppChangelog>;
  },
  checkUpdates: () => http<UpdateCheck>("/updates/check", { method: "POST", body: "{}" }),
  notifications: () => http<{ notifications: AppNotification[]; unread: number }>("/notifications"),
  readNotification: (id: number) => http<{ ok: true }>(`/notifications/${id}/read`, { method: "POST", body: "{}" }),
  readAllNotifications: () => http<{ ok: true }>("/notifications/read-all", { method: "POST", body: "{}" }),
  live: () => http<{ videos: Video[] }>("/live"),
  channelLive: (id: string) => http<{ videos: Video[] }>(`/channels/${id}/live`),
  video: (id: string) => http<{ video: Video; related: Video[] }>(`/videos/${id}`),
  watchlist: () => http<{ videos: Video[] }>("/watchlist"),
  archive: (page = 0) => http<{ videos: Video[] }>(`/archive?page=${page}`),
  history: (page = 0) => http<{ videos: Video[] }>(`/history?page=${page}`),
  insights: (days = 30, profileId: number | null = null) => {
    const qs = new URLSearchParams({ days: String(days), profile: profileId == null ? "all" : String(profileId) });
    return http<HouseholdInsights>(`/insights?${qs}`);
  },
  recordSponsorBlockSkip: (videoId: string, segment: SponsorSegment, skippedSeconds: number) =>
    http<{ ok: true; recorded: boolean }>(`/videos/${videoId}/sponsorblock-skip`, {
      method: "POST",
      body: JSON.stringify({
        event_id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        segment_uuid: segment.UUID || `${videoId}:${segment.category}:${segment.segment[0]}:${segment.segment[1]}`,
        category: segment.category,
        skipped_seconds: skippedSeconds,
        segment_start: segment.segment[0],
        segment_end: segment.segment[1],
      }),
    }),

  queue: (id: string, bucket: Bucket) =>
    http(`/videos/${id}/queue`, { method: "POST", body: JSON.stringify({ bucket }) }),
  saveProgress: (id: string, position: number, duration: number) =>
    http(`/videos/${id}/progress`, { method: "PUT", body: JSON.stringify({ position, duration }) }),
  clearProgress: (id: string) => http(`/videos/${id}/progress`, { method: "DELETE" }),
  dequeue: (id: string) => http(`/videos/${id}/dequeue`, { method: "POST" }),
  archiveVideo: (id: string) => http(`/videos/${id}/archive`, { method: "POST" }),
  restore: (id: string) => http(`/videos/${id}/restore`, { method: "POST" }),
  watch: (id: string) => http(`/videos/${id}/watch`, { method: "POST" }),
  complete: (id: string) => http(`/videos/${id}/complete`, { method: "POST" }),
  likeVideo: (id: string, liked: boolean) =>
    http(`/videos/${id}/like`, { method: "PUT", body: JSON.stringify({ liked }) }),
  tagVideo: (id: string, tag_id: number) =>
    http(`/videos/${id}/tags`, { method: "POST", body: JSON.stringify({ tag_id }) }),
  untagVideo: (id: string, tagId: number) =>
    http(`/videos/${id}/tags/${tagId}`, { method: "DELETE" }),

  channels: () => http<{ channels: Channel[] }>("/channels"),
  channel: (id: string) => http<{ channel: Channel }>(`/channels/${id}`),
  recentChannels: () => http<{ channels: (Channel & { latest_thumbnail: string | null; latest_video_id: string | null; watched: number; watch_position: number | null; watch_duration: number | null })[] }>("/channels/recent"),
  topChannels: () => http<{ channels: (Channel & { watch_count: number; is_live: number })[] }>("/channels/top"),
  syncChannel: (id: string) => http<{ added: number }>(`/channels/${id}/sync`, { method: "POST" }),
  addChannel: (url: string, customName?: string) =>
    http<{ channel_id: string; title: string }>("/channels", { method: "POST", body: JSON.stringify({ url, custom_name: customName || undefined }) }),
  renameChannel: (id: string, customTitle: string | null) =>
    http<{ channel: Channel }>(`/channels/${id}/name`, { method: "PUT", body: JSON.stringify({ custom_title: customTitle }) }),
  removeChannel: (id: string) => http(`/channels/${id}`, { method: "DELETE" }),
  tagChannel: (id: string, tag_id: number) =>
    http(`/channels/${id}/tags`, { method: "POST", body: JSON.stringify({ tag_id }) }),
  untagChannel: (id: string, tagId: number) =>
    http(`/channels/${id}/tags/${tagId}`, { method: "DELETE" }),
  importFile: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return http<{ found: number; added: number }>("/channels/import", { method: "POST", body: fd });
  },
  importAnalyze: (files: File[]) => {
    const fd = new FormData();
    for (const file of files) fd.append("file", file);
    return http<ImportManifest>("/import/analyze", { method: "POST", body: fd });
  },
  importCommit: (payload: ImportCommitPayload) =>
    http<ImportCommitResult>("/import/commit", { method: "POST", body: JSON.stringify(payload) }),

  tags: () => http<{ tags: Tag[] }>("/tags"),
  addTag: (name: string, color: string) =>
    http<{ tag: Tag }>("/tags", { method: "POST", body: JSON.stringify({ name, color }) }),
  updateTag: (id: number, patch: { name?: string; color?: string; filter_only?: number }) =>
    http<{ tag: Tag }>(`/tags/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  removeTag: (id: number) => http(`/tags/${id}`, { method: "DELETE" }),

  rules: () => http<{ rules: Rule[] }>("/rules"),
  addRule: (r: { tag_id: number; pattern: string; match_type: string; field: string }) =>
    http<{ matched: number }>("/rules", { method: "POST", body: JSON.stringify(r) }),
  updateRule: (id: number, patch: { tag_id?: number; pattern?: string; match_type?: string; field?: string }) =>
    http<{ rule: Rule }>(`/rules/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  removeRule: (id: number) => http(`/rules/${id}`, { method: "DELETE" }),

  filterRules: () => http<{ rules: FilterRule[] }>("/filter-rules"),
  addFilterRule: (r: { pattern: string; match_type: string; field: string; action: string; channel_id?: string | null }) =>
    http<{ rule: FilterRule; archived: number }>("/filter-rules", { method: "POST", body: JSON.stringify(r) }),
  updateFilterRule: (id: number, patch: { pattern?: string; match_type?: string; field?: string; action?: string; channel_id?: string | null }) =>
    http<{ rule: FilterRule }>(`/filter-rules/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  removeFilterRule: (id: number) => http(`/filter-rules/${id}`, { method: "DELETE" }),

  refresh: () => http<{ channels: number; added: number; errors: string[] }>("/refresh", { method: "POST" }),

  settings: () => http<{ settings: AppSettings }>("/settings"),
  updateSettings: (s: Partial<AppSettings>) =>
    http("/settings", { method: "PUT", body: JSON.stringify(s) }),
  childLock: () => http<{ child_lock: ChildLockStatus }>("/child-lock"),
  enableChildLock: (pin: string) =>
    http<{ child_lock: ChildLockStatus }>("/child-lock/enable", { method: "POST", body: JSON.stringify({ pin }) }),
  unlockChildLock: (pin: string) =>
    http<{ child_lock: ChildLockStatus }>("/child-lock/unlock", { method: "POST", body: JSON.stringify({ pin }) }),
  lockChildLock: () => http<{ child_lock: ChildLockStatus }>("/child-lock/lock", { method: "POST" }),
  changeChildLockPin: (newPin: string, currentPin?: string) =>
    http<{ child_lock: ChildLockStatus }>("/child-lock/change-pin", {
      method: "POST",
      body: JSON.stringify({ new_pin: newPin, current_pin: currentPin }),
    }),
  disableChildLock: (pin?: string) =>
    http<{ child_lock: ChildLockStatus }>("/child-lock/disable", { method: "POST", body: JSON.stringify({ pin }) }),

  followChannel: (id: string, followed: boolean) =>
    http(`/channels/${id}/follow`, { method: "PUT", body: JSON.stringify({ followed }) }),
  setChannelSpeed: (id: string, speed: string | null) =>
    http(`/channels/${id}/speed`, { method: "PUT", body: JSON.stringify({ speed }) }),
  setChannelCaptions: (id: string, mode: "off" | "language" | null, language?: string) =>
    http(`/channels/${id}/captions`, { method: "PUT", body: JSON.stringify({ mode, language }) }),
  setChannelMembersOnlyVisibility: (id: string, visibility: MembersOnlyVisibility) =>
    http(`/channels/${id}/members-only-feed`, { method: "PUT", body: JSON.stringify({ visibility }) }),
  setChannelDownloadMinDuration: (id: string, seconds: number | null) =>
    http(`/channels/${id}/download-min-duration`, { method: "PUT", body: JSON.stringify({ seconds }) }),
  unfollowedChannels: () => http<{ channels: Channel[] }>("/channels/unfollowed"),

  channelAbout: (id: string) => http<ChannelAbout>(`/channels/${id}/about`),
  channelPlaylists: (id: string) => http<{ playlists: PlaylistInfo[] }>(`/channels/${id}/playlists`),
  syncChannelPlaylists: (id: string) => http<{ playlists: PlaylistInfo[]; count: number; synced: number; added: number; errors: number }>(`/channels/${id}/playlists/sync`, { method: "POST" }),
  syncChannelMetadata: (id: string) => http<{ checked: number; updated: number; dates: number; durations: number; shorts: number; failed: number; remaining: number }>(`/channels/${id}/metadata/sync`, { method: "POST" }),
  channelPlaylist: (id: string) => http<{ playlist: FollowedPlaylist }>(`/channel-playlists/${id}`),
  channelPlaylistVideos: (id: string) => http<{ videos: Video[] }>(`/channel-playlists/${id}/videos`),
  followPlaylist: (id: string, followed: boolean) => http<{ followed: boolean }>(`/channel-playlists/${id}/follow`, { method: "PUT", body: JSON.stringify({ followed }) }),
  syncPlaylist: (id: string) => http<{ added: number }>(`/channel-playlists/${id}/sync`, { method: "POST" }),
  followedPlaylists: () => http<{ playlists: FollowedPlaylist[] }>("/followed-playlists"),
  followedPlaylistUpdates: () => http<{ playlists: FollowedPlaylistUpdates[] }>("/followed-playlists/updates"),
  playlistVideos: (id: string) => http<{ videos: PlaylistVideo[] }>(`/playlists/${id}/videos`),

  userPlaylists: (videoId?: string) => {
    const qs = videoId ? `?video_id=${encodeURIComponent(videoId)}` : "";
    return http<{ playlists: UserPlaylist[] }>(`/playlists${qs}`);
  },
  createUserPlaylist: (p: { name: string; icon?: string }) =>
    http<{ playlist: UserPlaylist }>("/playlists", { method: "POST", body: JSON.stringify(p) }),
  updateUserPlaylist: (id: number, p: Partial<Pick<UserPlaylist, "name" | "icon" | "sort_order">>) =>
    http<{ playlist: UserPlaylist }>(`/playlists/${id}`, { method: "PUT", body: JSON.stringify(p) }),
  deleteUserPlaylist: (id: number) => http(`/playlists/${id}`, { method: "DELETE" }),
  userPlaylist: (id: number) => http<{ playlist: UserPlaylist; videos: Video[] }>(`/playlists/${id}`),
  addVideoToUserPlaylist: (id: number, video_id: string) =>
    http(`/playlists/${id}/videos`, { method: "POST", body: JSON.stringify({ video_id }) }),
  removeVideoFromUserPlaylist: (id: number, videoId: string) =>
    http(`/playlists/${id}/videos/${videoId}`, { method: "DELETE" }),
  userPlaylistRules: (id: number) => http<{ rules: UserPlaylistRule[] }>(`/playlists/${id}/rules`),
  addUserPlaylistRule: (id: number, r: { pattern: string; match_type: string; field: string }) =>
    http<{ rule: UserPlaylistRule; matched: number }>(`/playlists/${id}/rules`, { method: "POST", body: JSON.stringify(r) }),
  removeUserPlaylistRule: (id: number, ruleId: number) =>
    http(`/playlists/${id}/rules/${ruleId}`, { method: "DELETE" }),
  applyUserPlaylistRules: (id: number) =>
    http<{ matched: number }>(`/playlists/${id}/rules/apply`, { method: "POST" }),

  chapters: (videoId: string) => http<{ chapters: VideoChapter[] }>(`/videos/${videoId}/chapters`),
  videoPlaylists: (videoId: string) =>
    http<{ playlists: VideoChannelPlaylist[] }>(`/videos/${videoId}/playlists`),
  videoCreators: (videoId: string) =>
    http<{ creators: VideoCreator[] }>(`/videos/${videoId}/creators`),

  profiles: () => http<{ profiles: Profile[]; active_id: number }>("/profiles"),
  createProfile: (p: { name: string; avatar_color?: string; pin?: string }) =>
    http<{ profile: Profile }>("/profiles", { method: "POST", body: JSON.stringify(p) }),
  updateProfile: (id: number, p: { name?: string; avatar_color?: string; pin?: string | null; is_child?: boolean; child_config?: Partial<ChildConfig> }) =>
    http<{ profile: Profile }>(`/profiles/${id}`, { method: "PATCH", body: JSON.stringify(p) }),
  deleteProfile: (id: number, pin?: string) =>
    http<{ active_id?: number }>(`/profiles/${id}`, { method: "DELETE", body: JSON.stringify({ pin }) }),
  switchProfile: (id: number, pin?: string, childLockPin?: string) =>
    http<{ active_id: number }>("/profiles/switch", { method: "POST", body: JSON.stringify({ id, pin, child_lock_pin: childLockPin }) }),
  unlockChildProfile: (id: number) => http<{ ok: boolean }>(`/profiles/${id}/unlock-child`, { method: "POST" }),
  uploadProfileAvatar: (id: number, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return http<{ profile: Profile }>(`/profiles/${id}/avatar`, { method: "POST", body: fd });
  },
  removeProfileAvatar: (id: number) => http<{ profile: Profile }>(`/profiles/${id}/avatar`, { method: "DELETE" }),
  resetProfilePin: (id: number) => http<{ profile: Profile }>(`/profiles/${id}/reset-pin`, { method: "POST" }),

  // ---------- child profiles (time limits & requests) ----------
  childStatus: () => http<ChildStatus>("/child/status"),
  childNowWatching: () => http<{ watching: ChildNowWatching[] }>("/child/now-watching"),
  stopChildWatching: (userId: number) =>
    http<{ ok: boolean }>(`/child/now-watching/${userId}/stop`, { method: "POST" }),
  childTimeRequest: (videoId?: string | null) =>
    http<{ ok: boolean; id: number }>("/child/time-request", { method: "POST", body: JSON.stringify({ video_id: videoId ?? null }) }),
  childTimeRequests: () => http<{ requests: ChildTimeRequest[] }>("/child/time-requests"),
  resolveChildTimeRequest: (id: number, action: "dismiss" | "approve", grant?: ChildGrant, pin?: string) =>
    http<{ ok: boolean }>(`/child/time-requests/${id}/resolve`, { method: "POST", body: JSON.stringify({ action, grant, pin }) }),

  config: () => http<{ app_url: string }>("/config"),

  // ---------- authentication ----------
  authStatus: () => http<AuthStatus>("/auth/status"),
  passwordLogin: (username: string, password: string) =>
    http<{ ok: true; active_id?: number }>("/auth/password/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  passkeyLoginOptions: () => http<{ options: any; flowId: string }>("/auth/passkey/login/options", { method: "POST", body: "{}" }),
  passkeyLoginVerify: (flowId: string, response: any) =>
    http<{ ok: true; active_id?: number }>("/auth/passkey/login/verify", { method: "POST", body: JSON.stringify({ flowId, response }) }),
  passkeyRegisterOptions: (target: "shared" | "self") =>
    http<{ options: any; flowId: string }>("/auth/passkey/register/options", { method: "POST", body: JSON.stringify({ target }) }),
  passkeyRegisterVerify: (flowId: string, response: any, label?: string) =>
    http<{ ok: true }>("/auth/passkey/register/verify", { method: "POST", body: JSON.stringify({ flowId, response, label }) }),
  deletePasskey: (id: number) => http<{ ok: true }>(`/auth/passkey/${id}`, { method: "DELETE" }),
  logout: () => http<{ ok: true; logout_url: string }>("/auth/logout", { method: "POST", body: "{}" }),
  authConfig: () => http<AuthConfig>("/auth/config"),
  saveAuthConfig: (body: AuthConfigUpdate) => http<{ ok: true }>("/auth/config", { method: "PUT", body: JSON.stringify(body) }),
  testOidc: () => http<{ ok: boolean; authorization_endpoint?: string; token_endpoint?: string; error?: string }>("/auth/test-oidc", { method: "POST", body: "{}" }),
  setAuthMethod: (method: AuthMethod) => http<{ ok: true }>("/auth/method", { method: "POST", body: JSON.stringify({ method }) }),
  assignAllChannels: (user_id: number) =>
    http<{ ok: true; added: number }>("/channels/assign-all", { method: "POST", body: JSON.stringify({ user_id }) }),

  sponsorblock: async (videoId: string, categories: string[]): Promise<SponsorSegment[]> => {
    const qs = new URLSearchParams({ videoID: videoId, categories: JSON.stringify(categories) });
    const res = await fetch(`https://sponsor.ajay.app/api/skipSegments?${qs}`);
    if (res.status === 404) return [];
    if (!res.ok) return [];
    return res.json();
  },
};
