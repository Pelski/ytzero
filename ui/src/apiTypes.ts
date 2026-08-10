import type { I18nKey } from "./i18n";
import type { EmojiSkinTone } from "./emojiSkinTone";
import type { PlaybackQueueContext } from "./playbackQueue";
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
  found_at: string;
  published_at_approximate: number;
  members_only: number;
  is_private: number;
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
  playback_context?: PlaybackQueueContext | null;
}

export interface DeArrowBranding {
  title: string | null;
  thumbnail: string | null;
}

export type MembersOnlyVisibility = "default" | "everywhere" | "channel" | "hidden";
export type ShortsFeedMode = "0" | "selected" | "1";
export type ChannelShortsFeedVisibility = "default" | "show";
export type ChannelManualStatus = "active" | "paused" | "broken" | "banned" | "deleted";

export interface ChannelRefreshScheduleDetails {
  mode: "adaptive" | "manual";
  days: number[];
  times: string[];
  timeZone: string;
  nextManualAt: string | null;
  automatic: {
    sampleCount: number;
    cadenceMs: number | null;
    targetIntervalMs: number;
    consecutiveFailures: number;
    lastAttemptedAt: string | null;
    nextRefreshAt: string | null;
  };
}

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
  shorts_feed_visibility?: ChannelShortsFeedVisibility;
  posts_enabled?: boolean;
  auto_download_min_duration_override?: number | null;
  subscribed_at?: string | null;
  latest_video_at?: string | null;
  video_count?: number;
  manual_status?: ChannelManualStatus;
  manual_status_updated_at?: string | null;
  tags: Tag[];
}
export type { ChannelSyncChannelStatus, ChannelSyncJob, ChannelSyncJobChannel } from "./channelSyncTypes";

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

export interface PlaylistDownloadResult {
  queued: number;
  skipped: number;
  total: number;
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

export interface VideoComment {
  id: string;
  parent: string | null;
  text: string;
  author: string;
  authorId: string | null;
  authorUrl: string | null;
  authorThumbnail: string | null;
  timestamp: number | null;
  timeText: string | null;
  likeCount: number;
  isPinned: boolean;
  isFavorited: boolean;
  authorIsUploader: boolean;
}

export interface VideoCommentsResponse {
  comments: VideoComment[];
  fetchedAt: string;
  cached: boolean;
}
export interface PlaylistVideo {
  videoId: string;
  title: string;
  thumbnail: string;
  channelTitle: string;
  duration: string;
  index: number;
  publishedAt: string | null;
  watched: number;
  watch_position: number | null;
  watch_duration: number | null;
}

export interface UserPlaylist {
  id: number;
  portable_uuid: string;
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
  show_shorts: ShortsFeedMode;
  player_hl: string;
  player_cc: string;
  player_cc_lang: string;
  player_sub_size: string;
  player_sub_color: string;
  player_sub_bg: string;
  player_quality: string;
  player_speed: string;
  keyboard_seek_seconds: string;
  enhance_enabled: string;
  enhance_replace_controls: string;
  enhance_frame_fps: string;
  player_screenshot_format: string;
  player_screenshot_quality: string;
  player_screenshot_filename: string;
  auto_fullscreen_landscape?: string;
  grid_size: string;
  video_card_actions: string;
  child_watching_monitor_enabled: string;
  child_lock_enabled: string;
  profile_admin_only_areas: string;
  app_name: string;
  timezone: string;
  app_icon_color: string;
  shorts_tab: string;
  show_top_channels: string;
  feed_max_age_value: string;
  /** days | weeks | months | years, or "off" to show videos of any age. */
  feed_max_age_unit: string;
  hide_live_from_feed: string;
  watch_show_related: string;
  watch_show_comments: string;
  channel_posts_tab: string;
  hide_members_only_from_feed: string;
  hide_members_only_on_channel: string;
  watched_style: string;
  sidebar_nav: string;
  sponsorblock_enabled: string;
  sponsorblock_categories: string;
  dearrow_titles_enabled: string;
  dearrow_thumbnails_enabled: string;
  update_check_interval: string;
  feed_autoplay_enabled: string;
  feed_autoplay_behavior: string;
  feed_autoplay_direction: string;
  feed_sort: string;
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
    error?: string;
    attempts?: number;
    actor?: SocialProfileRef;
    postId?: string;
    commentId?: string;
    commentBody?: string;
    postBody?: string;
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

export type SettingValue = number | string;
export interface SettingDefinition {
  key: string;
  label: string;
  description: string;
  type: "slider" | "select" | "toggle" | "text" | "time" | "multiselect";
  min?: number; max?: number; step?: number;
  options?: { value: string; label: string }[];
  defaultValue: SettingValue;
}
export type PluginSettingValue = SettingValue;
export type PluginSettingDef = SettingDefinition & { scope?: "user" | "global"; adminOnly?: boolean };
export interface PluginTermState {
  lastTerms: string[];
  blockedTerms: string[];
}

export interface PluginSettingsResponse {
  definitions: PluginSettingDef[];
  settings: Record<string, PluginSettingValue>;
  terms?: PluginTermState;
}
export type DownloadSettingValue = SettingValue;
export type DownloadSettingDef = SettingDefinition;
export interface SocialProfileRef {
  id: number;
  name: string;
  username: string;
  avatar: string;
  avatar_color: string;
}

export interface SocialMention {
  profile: SocialProfileRef;
  token: string;
}

export interface SocialComment {
  id: string;
  post_id: string;
  body: string;
  created_at: string;
  updated_at: string;
  author: SocialProfileRef;
  mentions: SocialMention[];
  like_count: number;
  liked_by_me: boolean;
  can_edit: boolean;
  can_delete: boolean;
}

export interface SocialPost {
  id: string;
  body: string;
  created_at: string;
  updated_at: string;
  author: SocialProfileRef;
  video: Video;
  comments_count: number;
  comment_preview: SocialComment[];
  reactions: Record<string, number>;
  reaction_profiles: Record<string, SocialProfileRef[]>;
  my_reactions: string[];
  mentions: SocialMention[];
  can_edit: boolean;
  can_delete: boolean;
}

export type { SocialWatchParty, SocialWatchPartyEvent, SocialWatchPartyMessage, SocialWatchPartyPlayback } from "./socialWatchPartyTypes";

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
  automation_rule_id: number | null;
  automation_rule_name: string | null;
  title: string;
  thumbnail: string;
  duration: string | null;
  is_short: number | null;
  published_at: string | null;
  channel_id: string;
  channel_title: string;
  user_id: number;
  profile_name: string;
  profile_color: string;
}

export interface DownloadsResponse {
  enabled: boolean;
  can_view_all: boolean;
  scope: "mine" | "all";
  ytdlp_version: string | null;
  stats: { files: number; bytes: number; queued: number; cap_bytes: number };
  active: { video_id: string; percent: number; total_bytes: number | null; speed: string | null } | null;
  downloads: DownloadItem[];
}

export interface DownloadSummary {
  enabled: boolean;
  queued: number;
  downloading: number;
  completed: number;
  errors: number;
}

export interface DownloadRuleInput {
  name: string;
  enabled: boolean;
  source_mode: "subscriptions" | "selected";
  channel_ids: string[];
  playlist_ids: string[];
  include_keywords: string[];
  exclude_keywords: string[];
  keyword_mode: "any" | "all";
  match_field: "title" | "description" | "both";
  include_shorts: boolean;
  include_members_only: boolean;
  min_duration_seconds: number;
  backfill_mode: "future" | "recent" | "all";
  lookback_hours: number;
}

export interface DownloadRule extends DownloadRuleInput {
  id: number;
  portable_uuid: string;
  created_at: string;
  updated_at: string;
}

export interface DownloadRulePreview {
  matches: number;
  ready: number;
  existing: number;
  limited: boolean;
  sample: Array<{
    video_id: string;
    title: string;
    thumbnail: string;
    channel_id: string;
    channel_title: string;
    published_at: string | null;
    download_status: string | null;
  }>;
}

export interface DownloadAutomationOptions {
  channels: Array<{ channel_id: string; title: string; thumbnail: string }>;
  playlists: Array<{ playlist_id: string; title: string; thumbnail: string; channel_title: string }>;
}

export interface DownloadConfigResponse {
  definitions: DownloadSettingDef[];
  settings: Record<string, DownloadSettingValue>;
  can_manage: boolean;
  can_manage_admin_settings: boolean;
  admin_setting_keys: string[];
  enabled: boolean;
  cookies_configured: boolean;
  time_zone: string;
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

export type RecommendationTimeOfDay = "night" | "morning" | "afternoon" | "evening";

export interface RecommendationSummary {
  top_channels: Array<{ channel_id: string; title: string; count: number; seconds: number }>;
  top_tags: Array<Pick<Tag, "id" | "name" | "color"> & { count: number; seconds: number }>;
  time_of_day: RecommendationTimeOfDay | null;
  current_hour: number | null;
  watch_count: number;
  partial_count: number;
  based_on: string[];
}

export interface RecommendationsResponse {
  videos: Video[];
  page: number;
  limit: number;
  has_more: boolean;
  summary: RecommendationSummary;
}

export interface RecommendationsRequest {
  page: number;
  limit: number;
  refresh?: boolean;
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
  liveStatus: "none" | "live" | "upcoming" | "was_live";
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

export type ProfilePermissionArea = "channels" | "followed_playlists" | "imports" | "tags" | "filters" | "playlists" | "appearance" | "feed" | "navigation" | "playback" | "plugins" | "profiles";

export interface ChildLockStatus {
  enabled: boolean;
  locked: boolean;
}

export interface ProfilePermissions {
  admin_only_areas: ProfilePermissionArea[];
}

export interface Profile {
  id: number;
  name: string;
  avatar: string;
  avatar_color: string;
  has_pin: boolean;
  active: boolean;
  is_primary: boolean;
  is_admin: boolean;
  is_child: boolean;
  pin_locked: boolean;
  child_config: ChildConfig | null;
  child_status: {
    remaining_seconds: number | null;
    unlimited_today: boolean;
  } | null;
  can_switch: boolean;
  oidc_identity?: string;
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
  hide_other_profiles: boolean;
  is_admin?: boolean;
  can_manage_administrators: boolean;
  admin_delegation_available: boolean;
  scope?: "account" | "profile" | null;
  oidc_mode?: "mapped" | "gateway";
  proxy_header_seen?: boolean;
  username_field?: boolean;
  login?: { password: boolean; passkey: boolean; oidc: boolean };
}

export interface AuthConfig {
  method: AuthMethod;
  hide_other_profiles: boolean;
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
  hide_other_profiles?: boolean;
  shared?: { username?: string; password?: string };
  oidc?: Partial<AuthConfig["oidc"]> & { client_secret?: string };
  proxy?: { header?: string; logout_url?: string };
  profiles?: { id: number; oidc_subject?: string; proxy_match?: string }[];
}

export interface TemporaryProfileCredential {
  id: number;
  name: string;
  username: string;
  password: string;
}

export interface AppLogs {
  size: number;
  lines: string[];
  version: string;
  commit: string;
}

export interface AppLogStreamEvent {
  line: string;
  size: number;
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
  current?: boolean;
  available?: boolean;
  upcoming?: boolean;
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
  releases: AppRelease[];
  availableReleases: AppRelease[];
}

export type Bucket = "today" | "tonight" | "tomorrow" | "tomorrow_evening" | "weekend";

export const BUCKET_LABELS: Record<Bucket, string> = {
  today: "Dzisiaj",
  tonight: "Dziś wieczorem",
  tomorrow: "Jutro",
  tomorrow_evening: "Jutro wieczorem",
  weekend: "Weekend",
};


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

export interface CleanupChannelFilter {
  mode: "include" | "exclude";
  ids: string[];
}

export interface CleanupTagFilter {
  include: number[];
  exclude: number[];
}

export interface CleanupFilter {
  status?: "inbox" | "queued" | "all";
  /** App-local YYYY-MM-DD boundary or ISO timestamp; matches videos strictly before it. */
  before?: string | null;
  channels?: CleanupChannelFilter | null;
  tags?: CleanupTagFilter | null;
  /** Also match videos the feed itself would hide (shorts, live, members-only, filter rules). */
  include_hidden?: boolean;
}

export interface CleanupPreviewResult {
  videos: Video[];
  total: number;
  page: number;
  limit: number;
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

export interface BackupOptions {
  formatVersion: number;
  presets: Record<string, string[]>;
  sections: { id: string; schemaVersion: number; scope: "instance" | "profile"; sensitivity: "normal" | "personal"; dependencies: string[]; category: string; optional?: boolean }[];
  profiles: { id: string; name: string; isChild: boolean }[];
  exclusions: string[];
}

export interface RestoreAnalysis {
  sessionId: string;
  expiresAt: string;
  archiveBytes: number;
  integrity: "verified";
  sameSource: boolean;
  warnings: string[];
  exclusions: string[];
  existingProfiles: { id: number; portable_uuid: string; name: string }[];
  manifest: {
    createdAt: string;
    appVersion: string;
    exportPreset: string;
    profiles: { id: string; name: string; isChild: boolean }[];
    sections: { id: string; profileId?: string; records: number }[];
  };
}

export interface DatabaseStatus {
  engine: "sqlite" | "postgres";
  location: string;
  state: "current" | "migration_ready" | "unexpected_change";
  previousEngine: "sqlite" | "postgres";
  pendingReceiptId: string | null;
}
