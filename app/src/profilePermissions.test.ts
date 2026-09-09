import { describe, expect, test } from "bun:test";
import {
  DEFAULT_STANDARD_PERMISSIONS,
  DEFAULT_ADMIN_ONLY_AREAS,
  parseAdminOnlyAreas,
  permissionAreaForMutation,
  permissionAreasForSettings,
  serializeAdminOnlyAreas,
  SETTING_PERMISSION_AREAS,
  settingsMutationRequiresAdmin,
} from "./profilePermissions";
import { USER_SETTING_KEYS } from "./db";

describe("profile administrator permissions", () => {
  test("classifies every persisted profile setting", () => {
    expect(USER_SETTING_KEYS.filter((key) => !(key in SETTING_PERMISSION_AREAS))).toEqual([]);
  });
  test("uses safe defaults for missing or invalid settings", () => {
    expect(parseAdminOnlyAreas(null)).toEqual([...DEFAULT_ADMIN_ONLY_AREAS]);
    expect(parseAdminOnlyAreas("not-json")).toEqual([...DEFAULT_ADMIN_ONLY_AREAS]);
    expect(parseAdminOnlyAreas('["unknown"]')).toEqual([...DEFAULT_ADMIN_ONLY_AREAS]);
    expect(DEFAULT_ADMIN_ONLY_AREAS).toEqual(["imports", "appearance", "feed", "navigation", "playback", "plugins", "profiles"]);
    expect(DEFAULT_STANDARD_PERMISSIONS).not.toContain("public_sharing");
  });

  test("accepts explicit v3 delegation and normalizes order and duplicates", () => {
    expect(parseAdminOnlyAreas("[]")).toEqual([]);
    expect(parseAdminOnlyAreas(serializeAdminOnlyAreas(["profiles", "channels", "profiles"]))).toEqual(["channels", "profiles"]);
  });

  test("expands broad v1 areas when migrating the old array format", () => {
    expect(parseAdminOnlyAreas('["channels","tags","settings"]')).toEqual([
      "channels",
      "followed_playlists",
      "imports",
      "tags",
      "filters",
      "appearance",
      "feed",
      "navigation",
      "playback",
    ]);
  });

  test("expands the broad v2 settings area into independent display permissions", () => {
    expect(parseAdminOnlyAreas('{"version":2,"adminOnlyAreas":["settings","profiles"]}')).toEqual([
      "appearance",
      "feed",
      "navigation",
      "playback",
      "profiles",
    ]);
  });

  test("classifies setting updates by their visible sections", () => {
    expect(permissionAreasForSettings({ language: "pl", watched_style: "dimmed" })).toEqual(["appearance"]);
    expect(permissionAreasForSettings({ feed_max_age_unit: "months", hide_live_from_feed: "1" })).toEqual(["feed"]);
    expect(permissionAreasForSettings({ show_shorts: "1", channel_posts_tab: "1" })).toEqual(["feed"]);
    expect(permissionAreasForSettings({ sidebar_nav: "[]" })).toEqual(["navigation"]);
    expect(permissionAreasForSettings({ player_speed: "1.5", player_speed_options: '["2.3"]', sponsorblock_enabled: "1" })).toEqual(["playback"]);
    expect(permissionAreasForSettings({ video_card_actions: "hover", video_card_action_buttons: "{}", video_card_swipe_devices: "{}", video_card_preview: "all" })).toEqual(["playback"]);
    expect(permissionAreasForSettings({ dearrow_titles_enabled: "1", dearrow_thumbnails_enabled: "1" })).toEqual(["playback"]);
    expect(permissionAreasForSettings({ child_watching_monitor_enabled: "0" })).toEqual(["navigation"]);
    expect(permissionAreasForSettings({ language: "pl", player_speed: "1.5" })).toEqual(["appearance", "playback"]);
    expect(permissionAreasForSettings({ feed_sort: "arrival" })).toEqual(["feed"]);
  });

  test("keeps advanced and authentication settings administrator-only", () => {
    expect(settingsMutationRequiresAdmin({ update_check_interval: "daily" })).toBe(true);
    expect(settingsMutationRequiresAdmin({ timezone: "Europe/London" })).toBe(true);
    expect(settingsMutationRequiresAdmin({ auth_method: "shared" })).toBe(true);
    expect(settingsMutationRequiresAdmin({ show_shorts: "1" })).toBe(false);
  });

  test("maps mutations without treating profile switching as administration", () => {
    expect(permissionAreaForMutation("/channels/UC123/follow")).toBe("channels");
    expect(permissionAreaForMutation("/channels/UC123/tags")).toBe("tags");
    expect(permissionAreaForMutation("/channels/UC123/playlists/sync")).toBe("followed_playlists");
    expect(permissionAreaForMutation("/channel-playlists/PL123/follow")).toBe("followed_playlists");
    expect(permissionAreaForMutation("/channels/import")).toBe("imports");
    expect(permissionAreaForMutation("/import/analyze")).toBe("imports");
    expect(permissionAreaForMutation("/filter-rules/1")).toBe("filters");
    expect(permissionAreaForMutation("/playlists/1/videos")).toBe("playlists");
    expect(permissionAreaForMutation("/public-shares/share-id/rotate")).toBe("public_sharing");
    expect(permissionAreaForMutation("/profiles/2")).toBeNull();
    expect(permissionAreaForMutation("/profiles/switch")).toBeNull();
  });
});
