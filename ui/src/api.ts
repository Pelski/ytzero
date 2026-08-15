import { apiFetch } from "./apiTransport";
import { http, sharedGet } from "./apiHttp";
import type { EmojiSkinTone } from "./emojiSkinTone";
import { createSocialWatchPartyApi } from "./socialWatchPartyApi";
import type { PlaylistSort, UserPlaylistSort } from "./playlistSort";
import type { PlaybackQueueContext } from "./playbackQueue";
import type {
  PluginManifest,
  PluginSettingValue,
  PluginSettingsResponse,
} from "./pluginTypes";
import {
  BUCKET_LABELS, PLAYBACK_SPEEDS, SB_CATEGORIES,
  type AppChangelog,
  type AppLogs,
  type AppNotification,
  type AppSettings,
  type AppVersion,
  type AuthConfig,
  type AuthConfigUpdate,
  type AuthMethod,
  type AuthStatus,
  type BackupOptions,
  type Bucket,
  type Channel,
  type ChannelAbout,
  type ChannelManualStatus,
  type ChannelRefreshScheduleDetails,
  type ChannelSearchResult,
  type ChannelShortsFeedVisibility,
  type ChannelSyncJob,
  type ChildConfig,
  type ChildGrant,
  type ChildLockStatus,
  type ChildNowWatching,
  type ChildStatus,
  type ChildTimeRequest,
  type CleanupFilter,
  type CleanupPreviewResult,
  type DatabaseStatus,
  type DeArrowBranding,
  type DiscoveryRecommendation,
  type DownloadAutomationOptions,
  type DownloadConfigResponse,
  type DownloadSettingValue,
  type DownloadRule,
  type DownloadRuleInput,
  type DownloadRulePreview,
  type DownloadSummary,
  type DownloadsResponse,
  type FilterRule,
  type FollowedPlaylist,
  type FollowedPlaylistUpdates,
  type HouseholdInsights,
  type ImportCommitPayload,
  type ImportCommitResult,
  type ImportManifest,
  type MembersOnlyVisibility,
  type PlaylistDownloadResult,
  type PlaylistInfo,
  type PlaylistVideo,
  type Profile,
  type ProfilePermissionArea,
  type ProfilePermissions,
  type RecommendationsRequest,
  type RecommendationsResponse,
  type RestoreAnalysis,
  type Rule,
  type SearchResult,
  type SocialComment,
  type SocialPost,
  type SocialProfileRef,
  type SponsorSegment,
  type Tag,
  type TemporaryProfileCredential,
  type UpdateCheck,
  type UserPlaylist,
  type UserPlaylistRule,
  type Video,
  type VideoChapter,
  type VideoChannelPlaylist,
  type VideoCommentsResponse,
  type VideoCommentSort,
  type VideoCreator,
  type VideoDownload,
  type VideoInfo,
  type VideoSubtitle,
} from "./apiTypes";
import type { ChannelPost } from "./channelPostTypes";
export * from "./apiTypes";
export * from "./pluginTypes";
export { ApiError } from "./apiHttp";
export const api = {
  databaseStatus: () => http<DatabaseStatus>("/database/status"),
  migrateDatabaseToPostgres: (target_url: string) => http<{ receiptId: string; tables: number; rows: number; next: string }>("/database/migration/sqlite-to-postgres", { method: "POST", body: JSON.stringify({ target_url }) }),
  confirmDatabaseMigration: () => http<{ ok: true; status: DatabaseStatus }>("/database/migration/confirm", { method: "POST", body: "{}" }),
  backupOptions: () => http<BackupOptions>("/backup/options"),
  exportBackup: async (payload: { preset: string; profiles: string[]; sections: string[] }) => {
    const response = await apiFetch("/api/backup/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!response.ok) throw new Error((await response.json().catch(() => ({})) as any).error ?? `HTTP ${response.status}`);
    return response.blob();
  },
  restoreAnalyze: (file: File) => {
    const body = new FormData(); body.append("file", file);
    return http<RestoreAnalysis>("/restore/analyze", { method: "POST", body });
  },
  restorePlan: (payload: { sessionId: string; mappings: Record<string, { action: "create" | "merge" | "skip"; targetProfileId?: number }>; sections: string[]; strategy: "merge" | "replace" }) =>
    http<{ sessionId: string; planRevision: number; changes: { createProfiles: number; mergeProfiles: number; skipProfiles: number; records: number; sections: number; strategy: string }; warnings: string[] }>("/restore/plan", { method: "POST", body: JSON.stringify(payload) }),
  restoreCommit: (sessionId: string, planRevision: number) =>
    http<{ ok: true; snapshot: string; counts: { created: number; updated: number; skipped: number; warnings: string[] } }>("/restore/commit", { method: "POST", body: JSON.stringify({ sessionId, planRevision }) }),
  deleteRestoreSession: (id: string) => http<{ ok: true }>(`/restore/session/${id}`, { method: "DELETE" }),
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
    sort?: "published" | "arrival";
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
    if (p.sort === "arrival") qs.set("sort", "arrival");
    return sharedGet<{ videos: Video[] }>(`feed:${qs}`, `/feed?${qs}`);
  },
  cleanupPreview: (filter: CleanupFilter, side: "clean" | "remain", opts: { excludeVideoIds?: string[]; page?: number } = {}) =>
    http<CleanupPreviewResult>("/cleanup/preview", {
      method: "POST",
      body: JSON.stringify({ filter, side, exclude_video_ids: opts.excludeVideoIds ?? [], page: opts.page ?? 0 }),
    }),
  cleanupApply: (filter: CleanupFilter, action: "archive" | "watched", excludeVideoIds: string[] = []) =>
    http<{ affected: number }>("/cleanup/apply", {
      method: "POST",
      body: JSON.stringify({ filter, action, exclude_video_ids: excludeVideoIds }),
    }),
  cleanupUndo: () => http<{ restored: number }>("/cleanup/undo", { method: "POST", body: "{}" }),
  inProgress: () => sharedGet<{ videos: Video[] }>("in-progress", "/in-progress"),
  youtubeSearch: (q: string) => http<{ results: SearchResult[]; channels: ChannelSearchResult[] }>(`/search/youtube?q=${encodeURIComponent(q)}`),
  plugins: () => sharedGet<{ plugins: PluginManifest[] }>("plugins", "/plugins"),
  updatePlugin: (id: string, enabled: boolean) =>
    http<{ plugins: PluginManifest[] }>(`/plugins/${id}`, { method: "PUT", body: JSON.stringify({ enabled }) }),
  pluginSettings: (id: string) =>
    http<PluginSettingsResponse>(`/plugins/${id}/settings`),
  updatePluginSettings: (id: string, patch: Record<string, PluginSettingValue> | { blockedTerms: string[] }) =>
    http<PluginSettingsResponse>(`/plugins/${id}/settings`, { method: "PUT", body: JSON.stringify(patch) }),
  resetPlugin: (id: string) =>
    http<PluginSettingsResponse>(`/plugins/${id}/reset`, { method: "POST", body: "{}" }),
  socialProfiles: () => http<{ profiles: SocialProfileRef[] }>("/social/mentionable-profiles"),
  socialRecentEmojis: () => http<{ emojis: string[]; skinTone: EmojiSkinTone }>("/social/reactions/recent"),
  setSocialEmojiSkinTone: (skinTone: EmojiSkinTone) =>
    http<{ skinTone: EmojiSkinTone }>("/social/reactions/skin-tone", { method: "PUT", body: JSON.stringify({ skinTone }) }),
  socialPosts: (cursor?: string | null, limit = 20) => {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (cursor) qs.set("cursor", cursor);
    return http<{ posts: SocialPost[]; next_cursor: string | null }>(`/social/posts?${qs}`);
  },
  socialPost: (id: string) => http<{ post: SocialPost }>(`/social/posts/${id}`),
  createSocialPost: (video_id: string, body: string) =>
    http<{ post: SocialPost }>("/social/posts", { method: "POST", body: JSON.stringify({ video_id, body }) }),
  updateSocialPost: (id: string, body: string) =>
    http<{ post: SocialPost }>(`/social/posts/${id}`, { method: "PATCH", body: JSON.stringify({ body }) }),
  deleteSocialPost: (id: string) => http<{ ok: true }>(`/social/posts/${id}`, { method: "DELETE" }),
  setSocialReaction: (postId: string, reaction: string, selected: boolean) =>
    http<{ post: SocialPost }>(`/social/posts/${postId}/reactions/${encodeURIComponent(reaction)}`, { method: selected ? "PUT" : "DELETE", body: selected ? "{}" : undefined }),
  socialComments: (postId: string, cursor?: string | null, limit = 40) => {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (cursor) qs.set("cursor", cursor);
    return http<{ comments: SocialComment[]; next_cursor: string | null }>(`/social/posts/${postId}/comments?${qs}`);
  },
  createSocialComment: (postId: string, body: string) =>
    http<{ comment: SocialComment }>(`/social/posts/${postId}/comments`, { method: "POST", body: JSON.stringify({ body }) }),
  updateSocialComment: (id: string, body: string) =>
    http<{ comment: SocialComment }>(`/social/comments/${id}`, { method: "PATCH", body: JSON.stringify({ body }) }),
  deleteSocialComment: (id: string) => http<{ ok: true }>(`/social/comments/${id}`, { method: "DELETE" }),
  setSocialCommentLike: (id: string, liked: boolean) =>
    http<{ comment: SocialComment }>(`/social/comments/${id}/like`, { method: liked ? "PUT" : "DELETE", body: liked ? "{}" : undefined }),
  ...createSocialWatchPartyApi(http),
  downloadCookies: () => http<{ configured: boolean }>("/downloads/cookies"),
  uploadDownloadCookies: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return http<{ configured: boolean }>("/downloads/cookies", { method: "POST", body: fd });
  },
  removeDownloadCookies: () => http<{ configured: boolean }>("/downloads/cookies", { method: "DELETE" }),
  downloads: (scope: "mine" | "all" = "mine") => http<DownloadsResponse>(`/downloads${scope === "all" ? "?scope=all" : ""}`),
  cancelDownloadQueue: () => http<{ ok: true; cancelled: number }>("/downloads/queue", { method: "DELETE" }),
  downloadSummary: () => sharedGet<DownloadSummary>("downloads-summary", "/downloads/summary"),
  downloadConfig: () => sharedGet<DownloadConfigResponse>("downloads-config", "/downloads/config"),
  updateDownloadConfig: (patch: { enabled?: boolean; settings?: Record<string, DownloadSettingValue> }) =>
    http<DownloadConfigResponse>("/downloads/config", { method: "PUT", body: JSON.stringify(patch) }),
  downloadRules: () => http<{ rules: DownloadRule[]; can_manage: boolean }>("/downloads/automation"),
  downloadAutomationOptions: () => http<DownloadAutomationOptions>("/downloads/automation/options"),
  previewDownloadRule: (rule: DownloadRuleInput) => http<DownloadRulePreview>("/downloads/automation/preview", { method: "POST", body: JSON.stringify(rule) }),
  createDownloadRule: (rule: DownloadRuleInput) => http<{ rule: DownloadRule }>("/downloads/automation", { method: "POST", body: JSON.stringify(rule) }),
  updateDownloadRule: (id: number, patch: Partial<DownloadRuleInput>) => http<{ rule: DownloadRule }>(`/downloads/automation/${id}`, { method: "PUT", body: JSON.stringify(patch) }),
  removeDownloadRule: (id: number) => http<{ ok: true }>(`/downloads/automation/${id}`, { method: "DELETE" }),
  requestDownload: (id: string, priority = false) =>
    http<{ ok: true; download: VideoDownload | null }>(`/videos/${id}/download`, { method: "POST", body: JSON.stringify({ priority }) }),
  videoDownload: (id: string) =>
    http<{ download: VideoDownload | null; progress: { percent: number; total_bytes: number | null; speed: string | null } | null }>(`/videos/${id}/download`),
  removeDownload: (id: string, profileId?: number) =>
    http<{ ok: true }>(`/videos/${id}/download${profileId ? `?profile_id=${profileId}` : ""}`, { method: "DELETE" }),
  pinDownload: (id: string, pinned: boolean, profileId?: number) =>
    http<{ ok: true; download: VideoDownload | null }>(`/videos/${id}/download/pin${profileId ? `?profile_id=${profileId}` : ""}`, { method: "PUT", body: JSON.stringify({ pinned }) }),
  streamUrl: (id: string) => `/api/videos/${id}/stream`,
  hlsUrl: (id: string) => `/api/videos/${id}/hls/index.m3u8`,
  audioUrl: (id: string) => `/api/videos/${id}/audio`,
  audioHlsUrl: (id: string) => `/api/videos/${id}/audio/index.m3u8`,
  liveAudioUrl: (id: string) => `/api/videos/${id}/audio-live/index.m3u8`,
  retryAudio: (id: string) => http<{ ok: true; live: boolean }>(`/videos/${id}/audio/retry`, { method: "POST", body: "{}" }),
  videoSubtitles: (id: string) => http<{ subtitles: VideoSubtitle[] }>(`/videos/${id}/subtitles`),
  downloadSubtitle: (id: string, lang: string) =>
    http<{ ok: boolean; downloaded: boolean; subtitles: VideoSubtitle[] }>(`/videos/${id}/subtitles`, { method: "POST", body: JSON.stringify({ lang }) }),
  videoTranscript: (id: string, language: string) =>
    http<{ language: string; transcript: string }>(`/videos/${id}/transcript`, { method: "POST", body: JSON.stringify({ language }) }),
  downloadFileUrl: (id: string) => `/api/videos/${id}/file`,
  discoveryRecommendations: (refresh = false) => http<{ enabled: boolean; recommendations: DiscoveryRecommendation[] }>(`/discovery/recommendations${refresh ? "?refresh=1" : ""}`),
  dismissDiscoveryRecommendation: (id: string) =>
    http<{ ok: true }>(`/discovery/recommendations/${id}/dismiss`, { method: "POST", body: "{}" }),
  recommendations: ({ page, limit, refresh = false }: RecommendationsRequest) => {
    const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (refresh) qs.set("refresh", "1");
    return http<RecommendationsResponse>(`/recommendations?${qs.toString()}`);
  },
  videoInfo: (id: string) => http<{ info: VideoInfo }>(`/videos/${id}/info`),
  externalVideos: () => http<{ videos: Video[] }>("/external"),
  clearExternal: () => http<{ deleted: number }>("/external", { method: "DELETE" }),
  removeExternal: (id: string) => http<{ deleted: number }>(`/external/${id}`, { method: "DELETE" }),
  logs: (limit = 300) => http<AppLogs>(`/logs?limit=${limit}`),
  logsStream: (limit = 300) => new EventSource(`/api/logs/stream?limit=${limit}`),
  version: () => http<AppVersion>("/version"),
  changelog: async (version?: string) => {
    const suffix = version ? `?version=${encodeURIComponent(version)}` : "";
    const response = await fetch(`/changelog.json${suffix}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json() as Promise<AppChangelog>;
  },
  checkUpdates: () => http<UpdateCheck>("/updates/check", { method: "POST", body: "{}" }),
  notifications: () => sharedGet<{ notifications: AppNotification[]; unread: number }>("notifications", "/notifications"),
  readNotification: (id: number) => http<{ ok: true }>(`/notifications/${id}/read`, { method: "POST", body: "{}" }),
  readAllNotifications: () => http<{ ok: true }>("/notifications/read-all", { method: "POST", body: "{}" }),
  live: () => http<{ videos: Video[] }>("/live"),
  channelLive: (id: string) => http<{ videos: Video[] }>(`/channels/${id}/live`),
  video: (id: string) => sharedGet<{ video: Video; related: Video[] }>(`video:${id}`, `/videos/${id}`),
  videoComments: (id: string, sort: VideoCommentSort = "top", refresh = false) =>
    http<VideoCommentsResponse>(`/videos/${id}/comments?sort=${sort}${refresh ? "&refresh=1" : ""}`),
  watchlist: () => sharedGet<{ videos: Video[] }>("watchlist", "/watchlist"),
  archive: (page = 0) => http<{ videos: Video[] }>(`/archive?page=${page}`),
  history: (page = 0) => http<{ videos: Video[]; page: number; has_more: boolean }>(`/history?page=${page}`),
  removeFromHistory: (historyId: number) => http<{ ok: true }>(`/history/${historyId}`, { method: "DELETE" }),
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
  saveProgress: (id: string, position: number, duration: number, keepalive = false) =>
    http(`/videos/${id}/progress`, { method: "PUT", body: JSON.stringify({ position, duration }), keepalive }),
  clearProgress: (id: string) => http(`/videos/${id}/progress`, { method: "DELETE" }),
  dequeue: (id: string) => http(`/videos/${id}/dequeue`, { method: "POST" }),
  archiveVideo: (id: string) => http(`/videos/${id}/archive`, { method: "POST" }),
  restore: (id: string) => http(`/videos/${id}/restore`, { method: "POST" }),
  watch: (id: string, playbackContext?: PlaybackQueueContext) => http(`/videos/${id}/watch`, { method: "POST", body: JSON.stringify(playbackContext ? { playback_context: playbackContext } : {}) }),
  playbackAdjacent: (id: string, direction: "oldest" | "newest", context: PlaybackQueueContext) =>
    http<{ video_id: string | null }>("/playback/adjacent", { method: "POST", body: JSON.stringify({ video_id: id, direction, context }) }),
  complete: (id: string) => http(`/videos/${id}/complete`, { method: "POST" }),
  markUnwatched: (id: string) => http(`/videos/${id}/complete`, { method: "DELETE" }),
  likeVideo: (id: string, liked: boolean) =>
    http(`/videos/${id}/like`, { method: "PUT", body: JSON.stringify({ liked }) }),
  tagVideo: (id: string, tag_id: number) =>
    http(`/videos/${id}/tags`, { method: "POST", body: JSON.stringify({ tag_id }) }),
  untagVideo: (id: string, tagId: number) =>
    http(`/videos/${id}/tags/${tagId}`, { method: "DELETE" }),
  channels: () => sharedGet<{ channels: Channel[]; instance_has_data: boolean }>("channels", "/channels"),
  channel: (id: string) => http<{ channel: Channel }>(`/channels/${id}`),
  recentChannels: () => sharedGet<{ channels: (Channel & { latest_thumbnail: string | null; latest_video_id: string | null; watched: number; watch_position: number | null; watch_duration: number | null })[] }>("channels-recent", "/channels/recent"),
  topChannels: () => sharedGet<{ channels: (Channel & { watch_count: number; is_live: number })[] }>("channels-top", "/channels/top"),
  syncChannel: (id: string) => http<{ job: ChannelSyncJob }>(`/channels/${id}/sync`, { method: "POST" }),
  channelSyncJob: () => http<{ job: ChannelSyncJob | null; busy: boolean }>("/channels/sync"),
  startChannelSync: (channelIds: string[]) => http<{ job: ChannelSyncJob }>("/channels/sync", { method: "POST", body: JSON.stringify({ channel_ids: channelIds }) }),
  addChannel: (url: string, customName?: string) =>
    http<{ channel_id: string; title: string }>("/channels", { method: "POST", body: JSON.stringify({ url, custom_name: customName || undefined }) }),
  renameChannel: (id: string, customTitle: string | null) =>
    http<{ channel: Channel }>(`/channels/${id}/name`, { method: "PUT", body: JSON.stringify({ custom_title: customTitle }) }),
  setChannelStatus: (id: string, status: ChannelManualStatus) =>
    http<{ ok: true; status: ChannelManualStatus }>(`/channels/${id}/status`, { method: "PUT", body: JSON.stringify({ status }) }),
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

  tags: () => sharedGet<{ tags: Tag[] }>("tags", "/tags"),
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

  settings: () => sharedGet<{ settings: AppSettings; settings_meta: { timezone_locked: boolean } }>("settings", "/settings"),
  bootstrapSettings: () => sharedGet<{ settings: AppSettings; settings_meta: { timezone_locked: boolean } }>("bootstrap-settings", "/settings", { suppressAuthenticationNavigation: true }),
  updateSettings: (s: Partial<AppSettings>) =>
    http("/settings", { method: "PUT", body: JSON.stringify(s) }),
  childLock: () => sharedGet<{ child_lock: ChildLockStatus }>("child-lock", "/child-lock"),
  profilePermissions: () => sharedGet<{ permissions: ProfilePermissions }>("profile-permissions", "/profile-permissions"),
  updateProfilePermissions: (adminOnlyAreas: ProfilePermissionArea[]) =>
    http<{ permissions: ProfilePermissions }>("/profile-permissions", { method: "PUT", body: JSON.stringify({ admin_only_areas: adminOnlyAreas }) }),
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
  setChannelShortsFeedVisibility: (id: string, visibility: ChannelShortsFeedVisibility) =>
    http(`/channels/${id}/shorts-feed`, { method: "PUT", body: JSON.stringify({ visibility }) }),
  setChannelDownloadMinDuration: (id: string, seconds: number | null) =>
    http(`/channels/${id}/download-min-duration`, { method: "PUT", body: JSON.stringify({ seconds }) }),
  channelRefreshSchedule: (id: string) => http<ChannelRefreshScheduleDetails>(`/channels/${id}/refresh-schedule`),
  setChannelRefreshSchedule: (id: string, schedule: { mode: "adaptive" | "manual"; days: number[]; times: string[] }) =>
    http<ChannelRefreshScheduleDetails>(`/channels/${id}/refresh-schedule`, { method: "PUT", body: JSON.stringify(schedule) }),
  unfollowedChannels: () => http<{ channels: Channel[] }>("/channels/unfollowed"),

  channelAbout: (id: string) => http<ChannelAbout>(`/channels/${id}/about`),
  channelPlaylists: (id: string) => http<{ playlists: PlaylistInfo[] }>(`/channels/${id}/playlists`),
  channelPosts: (id: string, language: "en" | "pl" | "de", refresh = false) => http<{ posts: ChannelPost[]; fetchedAt: string; cached: boolean }>(`/channels/${id}/posts?language=${language}${refresh ? "&refresh=1" : ""}`),
  syncChannelPlaylists: (id: string) => http<{ playlists: PlaylistInfo[]; count: number; synced: number; added: number; errors: number }>(`/channels/${id}/playlists/sync`, { method: "POST" }),
  syncChannelMetadata: (id: string) => http<{ checked: number; updated: number; dates: number; durations: number; shorts: number; failed: number; remaining: number }>(`/channels/${id}/metadata/sync`, { method: "POST" }),
  channelPlaylist: (id: string) => http<{ playlist: FollowedPlaylist }>(`/channel-playlists/${id}`),
  channelPlaylistVideos: (id: string, sort: PlaylistSort = "oldest") => http<{ videos: Video[]; processing: Video[]; order: string[] }>(`/channel-playlists/${id}/videos?sort=${encodeURIComponent(sort)}`),
  downloadChannelPlaylist: (id: string, sort: PlaylistSort = "playlist-order") => http<PlaylistDownloadResult>(`/channel-playlists/${id}/download?sort=${encodeURIComponent(sort)}`, { method: "POST", body: "{}" }),
  followPlaylist: (id: string, followed: boolean) => http<{ followed: boolean }>(`/channel-playlists/${id}/follow`, { method: "PUT", body: JSON.stringify({ followed }) }),
  syncPlaylist: (id: string) => http<{ added: number }>(`/channel-playlists/${id}/sync`, { method: "POST" }),
  followedPlaylists: () => http<{ playlists: FollowedPlaylist[] }>("/followed-playlists"),
  followedPlaylistUpdates: () => http<{ playlists: FollowedPlaylistUpdates[] }>("/followed-playlists/updates"),
  playlistVideos: (id: string, sort: PlaylistSort = "oldest") => http<{ videos: PlaylistVideo[] }>(`/playlists/${id}/videos?sort=${encodeURIComponent(sort)}`),

  userPlaylists: (videoId?: string) => {
    const qs = videoId ? `?video_id=${encodeURIComponent(videoId)}` : "";
    return sharedGet<{ playlists: UserPlaylist[] }>(`user-playlists:${videoId ?? "all"}`, `/playlists${qs}`);
  },
  createUserPlaylist: (p: { name: string; icon?: string }) =>
    http<{ playlist: UserPlaylist }>("/playlists", { method: "POST", body: JSON.stringify(p) }),
  updateUserPlaylist: (id: number, p: Partial<Pick<UserPlaylist, "name" | "icon" | "sort_order">>) =>
    http<{ playlist: UserPlaylist }>(`/playlists/${id}`, { method: "PUT", body: JSON.stringify(p) }),
  deleteUserPlaylist: (id: number) => http(`/playlists/${id}`, { method: "DELETE" }),
  userPlaylist: (id: number, sort: UserPlaylistSort = "added-newest") => http<{ playlist: UserPlaylist; videos: Video[] }>(`/playlists/${id}?sort=${encodeURIComponent(sort)}`),
  downloadUserPlaylist: (id: number, sort: UserPlaylistSort = "added-newest") => http<PlaylistDownloadResult>(`/playlists/${id}/download?sort=${encodeURIComponent(sort)}`, { method: "POST", body: "{}" }),
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

  chapters: (videoId: string) => sharedGet<{ chapters: VideoChapter[] }>(`video-chapters:${videoId}`, `/videos/${videoId}/chapters`),
  videoPlaylists: (videoId: string) =>
    sharedGet<{ playlists: VideoChannelPlaylist[] }>(`video-playlists:${videoId}`, `/videos/${videoId}/playlists`),
  videoCreators: (videoId: string) =>
    http<{ creators: VideoCreator[] }>(`/videos/${videoId}/creators`),

  profiles: () => sharedGet<{ profiles: Profile[]; active_id: number; oidc_mapping: { claim: string; required: boolean } | null; can_create: boolean; hide_other_profiles: boolean }>("profiles", "/profiles"),
  createProfile: (p: { name: string; avatar_color?: string; pin?: string; oidc_identity?: string; is_child?: boolean }) =>
    http<{ profile: Profile; temporary_credentials?: Omit<TemporaryProfileCredential, "id" | "name"> | null }>("/profiles", { method: "POST", body: JSON.stringify(p) }),
  updateProfile: (id: number, p: { name?: string; avatar_color?: string; pin?: string | null; oidc_identity?: string; is_child?: boolean; child_config?: Partial<ChildConfig> }) =>
    http<{ profile: Profile }>(`/profiles/${id}`, { method: "PATCH", body: JSON.stringify(p) }),
  setProfileAdministrator: (id: number, isAdmin: boolean) =>
    http<{ profile: Profile }>(`/profiles/${id}/admin`, { method: "PUT", body: JSON.stringify({ is_admin: isAdmin }) }),
  setProfileVisibility: (hideOtherProfiles: boolean) =>
    http<{ ok: true }>("/profiles/visibility", { method: "PUT", body: JSON.stringify({ hide_other_profiles: hideOtherProfiles }) }),
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
  childStatus: () => sharedGet<ChildStatus>("child-status", "/child/status"),
  childNowWatching: () => http<{ watching: ChildNowWatching[] }>("/child/now-watching"),
  stopChildWatching: (userId: number) =>
    http<{ ok: boolean }>(`/child/now-watching/${userId}/stop`, { method: "POST" }),
  childTimeRequest: (videoId?: string | null) =>
    http<{ ok: boolean; id: number }>("/child/time-request", { method: "POST", body: JSON.stringify({ video_id: videoId ?? null }) }),
  childTimeRequests: () => sharedGet<{ requests: ChildTimeRequest[] }>("child-time-requests", "/child/time-requests"),
  resolveChildTimeRequest: (id: number, action: "dismiss" | "approve", grant?: ChildGrant, pin?: string) =>
    http<{ ok: boolean }>(`/child/time-requests/${id}/resolve`, { method: "POST", body: JSON.stringify({ action, grant, pin }) }),

  config: () => sharedGet<{ app_url: string }>("config", "/config"),
  // ---------- authentication ----------
  authStatus: () => sharedGet<AuthStatus>("auth-status", "/auth/status"),
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
  generateProfileCredential: (id: number) => http<{ credential: TemporaryProfileCredential }>(`/auth/per-profile/credentials/${id}`, { method: "POST", body: "{}" }),
  changeProfilePassword: (currentPassword: string, newPassword: string) => http<{ ok: true }>("/auth/profile/password", { method: "PUT", body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }) }),
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
  dearrow: (videoId: string) => http<DeArrowBranding>(`/videos/${encodeURIComponent(videoId)}/dearrow`),
};
