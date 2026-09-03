/**
 * The permission vocabulary is deliberately independent from storage.  It is
 * shared by the access-control service, route guard and settings UI contract;
 * adding a capability therefore cannot silently create an unguarded route.
 */
export const PROFILE_PERMISSION_AREAS = [
  "channels", "followed_playlists", "imports", "tags", "filters", "playlists",
  "appearance", "feed", "navigation", "playback", "plugins", "profiles",
] as const;

export type ProfilePermissionArea = (typeof PROFILE_PERMISSION_AREAS)[number];
export type PermissionOverride = "allow" | "deny" | "inherit";

export const DEFAULT_STANDARD_PERMISSIONS: readonly ProfilePermissionArea[] = [
  "channels", "followed_playlists", "tags", "filters", "playlists",
  "appearance", "feed", "navigation", "playback", "plugins",
];

// Preserves the former safe household default for child profiles.
export const DEFAULT_RESTRICTED_PERMISSIONS: readonly ProfilePermissionArea[] = [
  "channels", "followed_playlists", "tags", "filters", "playlists",
];

export const PIN_PROTECTED_PERMISSION_AREAS = new Set<ProfilePermissionArea>([
  "channels", "followed_playlists", "imports", "appearance", "feed",
  "navigation", "playback", "plugins", "profiles",
]);

export function isProfilePermissionArea(value: unknown): value is ProfilePermissionArea {
  return typeof value === "string" && (PROFILE_PERMISSION_AREAS as readonly string[]).includes(value);
}

// Every per-profile Settings key has an explicit capability.  This is kept
// exhaustive by profilePermissions.test.ts.
export const SETTING_PERMISSION_AREAS: Readonly<Record<string, ProfilePermissionArea>> = {
  language: "appearance", youtube_title_language: "appearance", grid_size: "appearance", watched_style: "appearance",
  show_shorts: "feed", feed_max_age_value: "feed", feed_max_age_unit: "feed",
  hide_live_from_feed: "feed", channel_posts_tab: "feed",
  hide_members_only_from_feed: "feed", hide_members_only_on_channel: "feed",
  feed_sort: "feed",
  shorts_tab: "navigation", show_top_channels: "navigation", sidebar_nav: "navigation",
  // This only controls visibility of the profile's own monitoring shortcut.
  child_watching_monitor_enabled: "navigation",
  player_hl: "playback", player_cc: "playback", player_cc_lang: "playback",
  player_sub_size: "playback", player_sub_color: "playback", player_sub_bg: "playback",
  player_quality: "playback", player_speed: "playback", player_speed_options: "playback", keyboard_seek_seconds: "playback",
  keyboard_shortcuts: "playback", enhance_enabled: "playback",
  enhance_replace_controls: "playback", enhance_frame_fps: "playback",
  player_screenshot_format: "playback", player_screenshot_quality: "playback",
  player_screenshot_filename: "playback", auto_fullscreen_landscape: "playback",
  video_card_actions: "playback", video_card_preview: "playback",
  video_card_action_buttons: "playback", video_card_swipe_devices: "playback",
  watch_show_related: "playback", watch_show_comments: "playback",
  sponsorblock_enabled: "playback", sponsorblock_categories: "playback",
  dearrow_titles_enabled: "playback", dearrow_thumbnails_enabled: "playback",
  feed_autoplay_enabled: "playback", feed_autoplay_behavior: "playback",
  feed_autoplay_direction: "playback", update_check_interval: "profiles",
};

export function permissionAreaForMutation(path: string): ProfilePermissionArea | null {
  // Instance-wide plugin enablement/reset has a hard admin check in its
  // handler. Only profile-scoped plugin settings are delegated here.
  if (/^\/plugins\/[^/]+\/settings$/.test(path)) return "plugins";
  if (path === "/feed-builder" || path.startsWith("/feed-builder/") || path === "/feed/compositions" || path.startsWith("/feed/compositions/")) return "feed";
  if (path === "/profiles") return "profiles";
  if (path === "/filter-rules" || path.startsWith("/filter-rules/")) return "filters";
  if (path === "/tags" || path.startsWith("/tags/") || path === "/rules" || path.startsWith("/rules/")
    || path.startsWith("/videos/") && path.includes("/tags") || path.startsWith("/channels/") && path.includes("/tags")) return "tags";
  if (path === "/playlists" || path.startsWith("/playlists/")) return "playlists";
  if (path === "/channel-playlists" || path.startsWith("/channel-playlists/")
    || path.startsWith("/channels/") && path.includes("/playlists")) return "followed_playlists";
  if (path === "/channels/import" || path === "/import" || path.startsWith("/import/")) return "imports";
  if (path === "/channels" || path.startsWith("/channels/")) return "channels";
  return null;
}

export function permissionAreasForSettings(body: unknown): ProfilePermissionArea[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  const areas = new Set<ProfilePermissionArea>();
  for (const key of Object.keys(body)) {
    const area = SETTING_PERMISSION_AREAS[key];
    if (area) areas.add(area);
  }
  return PROFILE_PERMISSION_AREAS.filter((area) => areas.has(area));
}

// Legacy parser is retained for database and backup migration only.
const LEGACY_PERMISSION_AREAS = ["channels", "followed_playlists", "imports", "tags", "filters", "playlists", "settings", "plugins", "profiles"] as const;
const DISPLAY_PERMISSION_AREAS: readonly ProfilePermissionArea[] = ["appearance", "feed", "navigation", "playback"];
export const LEGACY_DEFAULT_ADMIN_ONLY_AREAS: readonly ProfilePermissionArea[] = ["imports", "appearance", "feed", "navigation", "playback", "plugins", "profiles"];

export function parseLegacyAdminOnlyAreas(raw: string | null | undefined): ProfilePermissionArea[] {
  if (!raw) return [...LEGACY_DEFAULT_ADMIN_ONLY_AREAS];
  try {
    const value = JSON.parse(raw);
    const areas = Array.isArray(value) ? value : value?.adminOnlyAreas;
    if (!Array.isArray(areas) || areas.some((area) => typeof area !== "string")) return [...LEGACY_DEFAULT_ADMIN_ONLY_AREAS];
    const migrated = new Set(areas);
    if (migrated.has("settings")) DISPLAY_PERMISSION_AREAS.forEach((area) => migrated.add(area));
    if (migrated.has("channels") && Array.isArray(value)) { migrated.add("followed_playlists"); migrated.add("imports"); }
    if (migrated.has("tags") && Array.isArray(value)) migrated.add("filters");
    if ([...migrated].some((area) => !isProfilePermissionArea(area) && !(LEGACY_PERMISSION_AREAS as readonly string[]).includes(area))) return [...LEGACY_DEFAULT_ADMIN_ONLY_AREAS];
    return PROFILE_PERMISSION_AREAS.filter((area) => migrated.has(area));
  } catch { return [...LEGACY_DEFAULT_ADMIN_ONLY_AREAS]; }
}

/** @deprecated compatibility helpers for old backup archives only. */
export const DEFAULT_ADMIN_ONLY_AREAS = LEGACY_DEFAULT_ADMIN_ONLY_AREAS;
/** @deprecated use parseLegacyAdminOnlyAreas. */
export const parseAdminOnlyAreas = parseLegacyAdminOnlyAreas;
/** @deprecated only serializes the archived v3 document. */
export function serializeAdminOnlyAreas(areas: readonly ProfilePermissionArea[]): string {
  return JSON.stringify({ version: 3, adminOnlyAreas: PROFILE_PERMISSION_AREAS.filter((area) => areas.includes(area)) });
}
/** @deprecated global settings are checked through GLOBAL_SETTING_KEYS. */
export function settingsMutationRequiresAdmin(body: unknown): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) return true;
  return Object.keys(body).some((key) => key === "update_check_interval" || key === "timezone" || key === "app_name" || key === "app_icon_color" || key === "child_lock_enabled" || key === "child_lock_pin_hash" || key === "profile_admin_only_areas" || key.startsWith("auth_"));
}
