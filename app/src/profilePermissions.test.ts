import { describe, expect, test } from "bun:test";
import {
  DEFAULT_ADMIN_ONLY_AREAS,
  parseAdminOnlyAreas,
  permissionAreaForMutation,
  permissionAreasForSettings,
  serializeAdminOnlyAreas,
  settingsMutationRequiresAdmin,
} from "./profilePermissions";

describe("profile administrator permissions", () => {
  test("uses safe defaults for missing or invalid settings", () => {
    expect(parseAdminOnlyAreas(null)).toEqual([...DEFAULT_ADMIN_ONLY_AREAS]);
    expect(parseAdminOnlyAreas("not-json")).toEqual([...DEFAULT_ADMIN_ONLY_AREAS]);
    expect(parseAdminOnlyAreas('["unknown"]')).toEqual([...DEFAULT_ADMIN_ONLY_AREAS]);
    expect(DEFAULT_ADMIN_ONLY_AREAS).toEqual(["imports", "appearance", "feed", "navigation", "playback", "plugins", "profiles"]);
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
    expect(permissionAreasForSettings({ player_speed: "1.5", sponsorblock_enabled: "1" })).toEqual(["playback"]);
    expect(permissionAreasForSettings({ dearrow_titles_enabled: "1", dearrow_thumbnails_enabled: "1" })).toEqual(["playback"]);
    expect(permissionAreasForSettings({ child_watching_monitor_enabled: "0" })).toEqual(["profiles"]);
    expect(permissionAreasForSettings({ language: "pl", player_speed: "1.5" })).toEqual(["appearance", "playback"]);
    expect(permissionAreasForSettings({ feed_sort: "arrival" })).toEqual([]);
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
    expect(permissionAreaForMutation("/profiles/2")).toBe("profiles");
    expect(permissionAreaForMutation("/profiles/switch")).toBeNull();
  });
});
