export const PROFILE_PERMISSION_AREAS = [
  "channels",
  "followed_playlists",
  "imports",
  "tags",
  "filters",
  "playlists",
  "appearance",
  "feed",
  "navigation",
  "playback",
  "plugins",
  "profiles",
] as const;

export type ProfilePermissionArea = (typeof PROFILE_PERMISSION_AREAS)[number];
export const PROFILE_PERMISSIONS_VERSION = 3;

// Safe household default: personal organization remains open, while changes
// affecting subscriptions, application behaviour, plugins and profiles stay
// with the administrator until explicitly delegated.
export const DEFAULT_ADMIN_ONLY_AREAS: readonly ProfilePermissionArea[] = [
  "channels",
  "followed_playlists",
  "imports",
  "appearance",
  "feed",
  "navigation",
  "playback",
  "plugins",
  "profiles",
];

const DISPLAY_PERMISSION_AREAS: readonly ProfilePermissionArea[] = ["appearance", "feed", "navigation", "playback"];
const LEGACY_PERMISSION_AREAS = ["channels", "followed_playlists", "imports", "tags", "filters", "playlists", "settings", "plugins", "profiles"] as const;

const SETTING_PERMISSION_AREAS: Readonly<Record<string, ProfilePermissionArea>> = {
  language: "appearance",
  grid_size: "appearance",
  video_card_actions: "feed",
  watched_style: "appearance",
  app_name: "appearance",
  app_icon_color: "appearance",
  feed_max_age_value: "feed",
  feed_max_age_unit: "feed",
  hide_live_from_feed: "feed",
  hide_members_only_from_feed: "feed",
  hide_members_only_on_channel: "feed",
  show_shorts: "feed",
  shorts_tab: "navigation",
  show_top_channels: "navigation",
  channel_posts_tab: "feed",
  sidebar_nav: "navigation",
  player_hl: "playback",
  player_cc: "playback",
  player_cc_lang: "playback",
  player_sub_size: "playback",
  player_sub_color: "playback",
  player_sub_bg: "playback",
  player_quality: "playback",
  player_speed: "playback",
  keyboard_seek_seconds: "playback",
  enhance_enabled: "playback",
  enhance_replace_controls: "playback",
  enhance_frame_fps: "playback",
  player_screenshot_format: "playback",
  player_screenshot_quality: "playback",
  player_screenshot_filename: "playback",
  auto_fullscreen_landscape: "playback",
  watch_show_related: "playback",
  watch_show_comments: "playback",
  sponsorblock_enabled: "playback",
  sponsorblock_categories: "playback",
  dearrow_titles_enabled: "playback",
  dearrow_thumbnails_enabled: "playback",
  feed_autoplay_enabled: "playback",
  feed_autoplay_behavior: "playback",
  feed_autoplay_direction: "playback",
  child_watching_monitor_enabled: "profiles",
};

export function isProfilePermissionArea(value: unknown): value is ProfilePermissionArea {
  return typeof value === "string" && (PROFILE_PERMISSION_AREAS as readonly string[]).includes(value);
}

export function parseAdminOnlyAreas(raw: string | null | undefined): ProfilePermissionArea[] {
  if (!raw) return [...DEFAULT_ADMIN_ONLY_AREAS];
  try {
    const value = JSON.parse(raw);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const document = value as { version?: unknown; adminOnlyAreas?: unknown };
      if (!Array.isArray(document.adminOnlyAreas)) {
        return [...DEFAULT_ADMIN_ONLY_AREAS];
      }
      const adminOnlyAreas = document.adminOnlyAreas;
      if (document.version === PROFILE_PERMISSIONS_VERSION) {
        if (adminOnlyAreas.some((area) => !isProfilePermissionArea(area))) return [...DEFAULT_ADMIN_ONLY_AREAS];
        return PROFILE_PERMISSION_AREAS.filter((area) => adminOnlyAreas.includes(area));
      }
      if (document.version === 2
        && adminOnlyAreas.every((area) => typeof area === "string" && (LEGACY_PERMISSION_AREAS as readonly string[]).includes(area))) {
        return migrateLegacyAreas(adminOnlyAreas as string[], false);
      }
      return [...DEFAULT_ADMIN_ONLY_AREAS];
    }
    if (!Array.isArray(value)
      || value.some((area) => typeof area !== "string" || !(LEGACY_PERMISSION_AREAS as readonly string[]).includes(area))) {
      return [...DEFAULT_ADMIN_ONLY_AREAS];
    }
    // v1 stored one flat array. Its broad "channels" and "tags" switches also
    // covered the areas split out in v2, so expand them during migration.
    return migrateLegacyAreas(value, true);
  } catch {
    return [...DEFAULT_ADMIN_ONLY_AREAS];
  }
}

function migrateLegacyAreas(areas: string[], expandV1Groups: boolean): ProfilePermissionArea[] {
  const migrated = new Set<string>(areas);
  if (expandV1Groups && migrated.has("channels")) {
    migrated.add("followed_playlists");
    migrated.add("imports");
  }
  if (expandV1Groups && migrated.has("tags")) migrated.add("filters");
  if (migrated.has("settings")) DISPLAY_PERMISSION_AREAS.forEach((area) => migrated.add(area));
  return PROFILE_PERMISSION_AREAS.filter((area) => migrated.has(area));
}

export function serializeAdminOnlyAreas(areas: readonly ProfilePermissionArea[]): string {
  return JSON.stringify({
    version: PROFILE_PERMISSIONS_VERSION,
    adminOnlyAreas: PROFILE_PERMISSION_AREAS.filter((area) => areas.includes(area)),
  });
}

export function permissionAreaForMutation(path: string): ProfilePermissionArea | null {
  if (path === "/plugins" || path.startsWith("/plugins/")) return "plugins";

  // Switching profiles is a viewing action with its own profile/child-lock PIN
  // checks. Only profile administration belongs to this permission area.
  if (path !== "/profiles/switch" && (path === "/profiles" || path.startsWith("/profiles/"))) return "profiles";

  if (path === "/filter-rules" || path.startsWith("/filter-rules/")) return "filters";

  if (path === "/tags" || path.startsWith("/tags/")
    || path === "/rules" || path.startsWith("/rules/")
    || path.startsWith("/videos/") && path.includes("/tags")
    || path.startsWith("/channels/") && path.includes("/tags")) return "tags";

  if (path === "/playlists" || path.startsWith("/playlists/")) return "playlists";

  if (path === "/channel-playlists" || path.startsWith("/channel-playlists/")
    || path.startsWith("/channels/") && path.includes("/playlists")) return "followed_playlists";

  if (path === "/channels/import" || path === "/import" || path.startsWith("/import/")) return "imports";

  if (path === "/channels" || path.startsWith("/channels/")) return "channels";

  return null;
}

export function permissionAreasForSettings(body: unknown): ProfilePermissionArea[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [...DISPLAY_PERMISSION_AREAS];
  const areas = new Set<ProfilePermissionArea>();
  for (const key of Object.keys(body)) {
    const area = SETTING_PERMISSION_AREAS[key];
    if (area) areas.add(area);
  }
  return PROFILE_PERMISSION_AREAS.filter((area) => areas.has(area));
}

export function settingsMutationRequiresAdmin(body: unknown): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) return true;
  return Object.keys(body).some((key) => key === "update_check_interval"
    || key === "timezone"
    || key === "child_lock_enabled"
    || key === "child_lock_pin_hash"
    || key === "profile_admin_only_areas"
    || key.startsWith("auth_"));
}
