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
  in_history: number;
  external?: number;
  liked: number | null;
  channel_title: string;
  channel_thumbnail: string | null;
  channel_subscriber_count: string | null;
  tags: Tag[];
  history_id?: number;
  watched_at?: string;
}

export interface Channel {
  channel_id: string;
  title: string;
  url: string;
  thumbnail: string;
  subscriber_count?: string | null;
  followed?: number;
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

export interface ChannelAbout {
  channelId: string;
  title: string;
  description: string;
  avatar: string;
  banner: string;
  stats: string[];
}

export interface PlaylistInfo {
  playlistId: string;
  title: string;
  thumbnail: string;
  videoCount: string;
}

export interface PlaylistVideo {
  videoId: string;
  title: string;
  thumbnail: string;
  channelTitle: string;
  duration: string;
  index: number;
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
  language: "en" | "pl";
  show_shorts: string;
  player_hl: string;
  player_cc: string;
  player_cc_lang: string;
  player_quality: string;
  grid_size: string;
  child_lock_enabled: string;
  app_name: string;
  shorts_tab: string;
  sponsorblock_enabled: string;
  sponsorblock_categories: string;
}

export interface SearchResult {
  videoId: string;
  title: string;
  thumbnail: string;
  duration: string;
  channelTitle: string;
  viewCount: number | null;
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

export interface SponsorSegment {
  category: string;
  actionType: string;
  segment: [number, number];
  UUID: string;
}

export const SB_CATEGORIES: { id: string; label: { en: string; pl: string }; color: string }[] = [
  { id: "sponsor",       label: { en: "Sponsor",           pl: "Sponsor"          }, color: "#00d400" },
  { id: "selfpromo",     label: { en: "Self-promotion",    pl: "Autopromocja"     }, color: "#ffff00" },
  { id: "interaction",   label: { en: "Interaction",       pl: "Prośba o reakcję" }, color: "#cc00ff" },
  { id: "intro",         label: { en: "Intro",             pl: "Intro"            }, color: "#00ffff" },
  { id: "outro",         label: { en: "Outro",             pl: "Outro"            }, color: "#0202ed" },
  { id: "preview",       label: { en: "Preview",           pl: "Podgląd treści"   }, color: "#008fd6" },
  { id: "music_offtopic",label: { en: "Non-music section", pl: "Nie-muzyczny"     }, color: "#ff9900" },
  { id: "filler",        label: { en: "Filler",            pl: "Wypełniacz"       }, color: "#7300ab" },
];

export interface ChildLockStatus {
  enabled: boolean;
  locked: boolean;
}

export type Bucket = "today" | "tonight" | "tomorrow" | "weekend";

export const BUCKET_LABELS: Record<Bucket, string> = {
  today: "Dzisiaj",
  tonight: "Dziś wieczorem",
  tomorrow: "Jutro",
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
  return res.json();
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
    if (p.limit) qs.set("limit", String(p.limit));
    return http<{ videos: Video[] }>(`/feed?${qs}`);
  },
  inProgress: () => http<{ videos: Video[] }>("/in-progress"),
  youtubeSearch: (q: string) => http<{ results: SearchResult[] }>(`/search/youtube?q=${encodeURIComponent(q)}`),
  videoInfo: (id: string) => http<{ info: VideoInfo }>(`/videos/${id}/info`),
  externalVideos: () => http<{ videos: Video[] }>("/external"),
  clearExternal: () => http<{ deleted: number }>("/external", { method: "DELETE" }),
  removeExternal: (id: string) => http<{ deleted: number }>(`/external/${id}`, { method: "DELETE" }),
  live: () => http<{ videos: Video[] }>("/live"),
  video: (id: string) => http<{ video: Video; related: Video[] }>(`/videos/${id}`),
  watchlist: () => http<{ videos: Video[] }>("/watchlist"),
  archive: (page = 0) => http<{ videos: Video[] }>(`/archive?page=${page}`),
  history: (page = 0) => http<{ videos: Video[] }>(`/history?page=${page}`),

  queue: (id: string, bucket: Bucket) =>
    http(`/videos/${id}/queue`, { method: "POST", body: JSON.stringify({ bucket }) }),
  saveProgress: (id: string, position: number, duration: number) =>
    http(`/videos/${id}/progress`, { method: "PUT", body: JSON.stringify({ position, duration }) }),
  clearProgress: (id: string) => http(`/videos/${id}/progress`, { method: "DELETE" }),
  dequeue: (id: string) => http(`/videos/${id}/dequeue`, { method: "POST" }),
  archiveVideo: (id: string) => http(`/videos/${id}/archive`, { method: "POST" }),
  restore: (id: string) => http(`/videos/${id}/restore`, { method: "POST" }),
  watch: (id: string) => http(`/videos/${id}/watch`, { method: "POST" }),
  likeVideo: (id: string, liked: boolean) =>
    http(`/videos/${id}/like`, { method: "PUT", body: JSON.stringify({ liked }) }),
  tagVideo: (id: string, tag_id: number) =>
    http(`/videos/${id}/tags`, { method: "POST", body: JSON.stringify({ tag_id }) }),
  untagVideo: (id: string, tagId: number) =>
    http(`/videos/${id}/tags/${tagId}`, { method: "DELETE" }),

  channels: () => http<{ channels: Channel[] }>("/channels"),
  channel: (id: string) => http<{ channel: Channel }>(`/channels/${id}`),
  recentChannels: () => http<{ channels: (Channel & { latest_thumbnail: string | null; latest_video_id: string | null })[] }>("/channels/recent"),
  syncChannel: (id: string) => http<{ added: number }>(`/channels/${id}/sync`, { method: "POST" }),
  addChannel: (url: string) =>
    http<{ channel_id: string; title: string }>("/channels", { method: "POST", body: JSON.stringify({ url }) }),
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
  unfollowedChannels: () => http<{ channels: Channel[] }>("/channels/unfollowed"),

  channelAbout: (id: string) => http<ChannelAbout>(`/channels/${id}/about`),
  channelPlaylists: (id: string) => http<{ playlists: PlaylistInfo[] }>(`/channels/${id}/playlists`),
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

  sponsorblock: async (videoId: string, categories: string[]): Promise<SponsorSegment[]> => {
    const qs = new URLSearchParams({ videoID: videoId, categories: JSON.stringify(categories) });
    const res = await fetch(`https://sponsor.ajay.app/api/skipSegments?${qs}`);
    if (res.status === 404) return [];
    if (!res.ok) return [];
    return res.json();
  },
};
