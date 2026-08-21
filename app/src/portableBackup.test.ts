import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import sharp from "sharp";
import { runIsolatedTestFile } from "../tests/isolatedTestFile";

const ISOLATION_FLAG = "YTZERO_PORTABLE_BACKUP_TEST_ISOLATED";
if (process.env[ISOLATION_FLAG] !== "1") {
  test("portable backup suite runs in an isolated application runtime", async () => {
    await runIsolatedTestFile("src/portableBackup.test.ts", ISOLATION_FLAG);
  });
} else {
const root = mkdtempSync(resolve(tmpdir(), "ytzero-portable-backup-"));
const avatarDir = resolve(root, "avatars");
process.env.DB_PATH = resolve(root, "db", "source.db");
process.env.RESTORE_SESSION_DIR = resolve(root, "sessions");
process.env.AVATAR_DIR = avatarDir;
process.env.TUBE_ARCHIVIST_CONFIG_DIR = resolve(root, "tubearchivist-secrets");

const backup = await import("./portableBackup");
const permissions = await import("./profilePermissions");
const plugins = await import("./plugins");
const videoCardActions = await import("./videoCardActions");
const tubeArchivist = await import("./tubeArchivist");
const { db, setSetting, setUserSetting, getSetting, getUserSetting, SETTING_DEFAULTS } = await import("./db");
const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function asLegacyDownloadsPluginArchive(bytes: Uint8Array): Promise<Uint8Array> {
  const entries = backup.readPortableZip(bytes);
  const manifest = JSON.parse(decoder.decode(entries.get("manifest.json")!));
  const profileDownloads = manifest.sections.find((section: any) => section.id === "profile.downloads");
  const profileSettings = manifest.sections.find((section: any) => section.id === "profile.settings" && section.profileId === profileDownloads.profileId);
  const instancePlugins = manifest.sections.find((section: any) => section.id === "instance.plugins");
  const downloads = JSON.parse(decoder.decode(entries.get(profileDownloads.path)!));
  const settings = JSON.parse(decoder.decode(entries.get(profileSettings.path)!));
  settings.plugins ??= {};
  settings.plugins.downloads = { schemaVersion: 4, payload: { settings: downloads.settings, rules: downloads.rules, playlists: downloads.playlists } };
  entries.set(profileSettings.path, encoder.encode(`${JSON.stringify(settings, null, 2)}\n`));
  const plugins = decoder.decode(entries.get(instancePlugins.path)!).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  plugins.push({ id: "downloads", enabled: downloads.enabled, schemaVersion: 4 });
  entries.set(instancePlugins.path, encoder.encode(`${plugins.map((plugin) => JSON.stringify(plugin)).join("\n")}\n`));
  for (const section of manifest.sections.filter((section: any) => section.id === "profile.downloads" || section.id === "instance.downloads")) entries.delete(section.path);
  manifest.sections = manifest.sections.filter((section: any) => section.id !== "profile.downloads" && section.id !== "instance.downloads");
  for (const section of [profileSettings, instancePlugins]) {
    const content = entries.get(section.path)!;
    section.bytes = content.byteLength;
    const digestInput = content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer;
    const digest = await crypto.subtle.digest("SHA-256", digestInput);
    section.sha256 = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  }
  entries.set("manifest.json", encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`));
  return backup.createZip([...entries].map(([name, content]) => ({ name, bytes: content })));
}

beforeAll(async () => {
  mkdirSync(avatarDir, { recursive: true });
  const avatar = await sharp({ create: { width: 900, height: 500, channels: 4, background: { r: 36, g: 118, b: 210, alpha: 1 } } }).png().toBuffer();
  writeFileSync(resolve(avatarDir, "1.png"), avatar);
  db.prepare("UPDATE users SET avatar='1.png:legacy-token' WHERE id=1").run();
  db.prepare("INSERT INTO channels(channel_id,title,url) VALUES(?,?,?)").run("UCportable", "Portable channel", "https://youtube.com/channel/UCportable");
  db.prepare("INSERT INTO user_channels(user_id,channel_id,followed) VALUES(1,'UCportable',1)").run();
  db.prepare("INSERT INTO videos(video_id,channel_id,title,external) VALUES('portable001','UCportable','Portable video',1)").run();
  db.prepare("INSERT INTO history(user_id,video_id,watched_at) VALUES(1,'portable001','2026-07-25 10:00:00')").run();
});

afterAll(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

describe("portable backup ZIP security", () => {
  test("round-trips UTF-8 entries", () => {
    const zip = backup.createZip([
      { name: "manifest.json", bytes: new TextEncoder().encode('{"name":"żółć"}') },
      { name: "instance/settings.json", bytes: new TextEncoder().encode("{}") },
    ]);
    expect(new TextDecoder().decode(backup.readPortableZip(zip).get("manifest.json"))).toContain("żółć");
  });

  test("rejects traversal and duplicate entries", () => {
    expect(() => backup.readPortableZip(backup.createZip([{ name: "manifest.json", bytes: new Uint8Array() }, { name: "../secret", bytes: new Uint8Array() }]))).toThrow("unsafe archive path");
    expect(() => backup.readPortableZip(backup.createZip([{ name: "manifest.json", bytes: new Uint8Array() }, { name: "manifest.json", bytes: new Uint8Array() }]))).toThrow("duplicate archive entry");
  });
});

describe("portable backup classification and restore", () => {
  test("registry contains no secret section", async () => {
    expect(backup.BACKUP_SECTIONS.some((section) => section.sensitivity === "secret")).toBe(false);
    expect((await backup.backupOptions()).exclusions.join(" ")).toContain("passkeys");
  });

  test("exports only safe TubeArchivist policy and excludes connection/cache sentinels", async () => {
    const secret = "TA_SECRET_SENTINEL_8d197";
    const baseUrl = "http://TA_MACHINE_SENTINEL.local:8000";
    const metadata = "TA_CACHE_SENTINEL_94ac3";
    tubeArchivist.saveTubeArchivistConfig({ baseUrl, token: secret });
    await plugins.setPluginSettings(1, "tubearchivist", { sync_interval_minutes: "360", sync_watched: 0 });
    db.prepare("INSERT INTO channels(channel_id,title) VALUES('UCtaBackup','TA backup')").run();
    db.prepare("INSERT INTO videos(video_id,channel_id,title) VALUES('taBackup01','UCtaBackup','TA backup video')").run();
    db.prepare("INSERT INTO tube_archivist_items(video_id,media_url,metadata_json) VALUES(?,?,?)").run("taBackup01", "/media/TA_PATH_SENTINEL.mp4", JSON.stringify({ metadata }));
    const zip = await backup.createPortableBackup({ preset: "full" });
    const archiveText = [...backup.readPortableZip(zip).values()].map((bytes) => decoder.decode(bytes)).join("\n");
    expect(archiveText).not.toContain(secret);
    expect(archiveText).not.toContain(baseUrl);
    expect(archiveText).not.toContain(metadata);
    expect(archiveText).not.toContain("TA_PATH_SENTINEL");
    expect(archiveText).toContain('"sync_interval_minutes":"360"');
    expect(archiveText).toContain('"sync_watched":0');
  });

  test("excludes the machine-local yt-dlp update policy and scheduler state", async () => {
    await setSetting("ytdlp_update_channel", "YTDLP_CHANNEL_SENTINEL");
    await setSetting("ytdlp_update_interval_days", "YTDLP_INTERVAL_SENTINEL");
    await setSetting("ytdlp_update_last_attempt_at", "YTDLP_ATTEMPT_SENTINEL");
    const zip = await backup.createPortableBackup({ preset: "full" });
    const archiveText = [...backup.readPortableZip(zip).values()].map((bytes) => decoder.decode(bytes)).join("\n");
    expect(archiveText).not.toContain("YTDLP_CHANNEL_SENTINEL");
    expect(archiveText).not.toContain("YTDLP_INTERVAL_SENTINEL");
    expect(archiveText).not.toContain("YTDLP_ATTEMPT_SENTINEL");
  });

  test("round-trips the Shorts feed mode and per-channel opt-in", async () => {
    const options = await backup.backupOptions();
    const profile = options.profiles[0];
    await setUserSetting(1, "show_shorts", "disabled");
    db.prepare("UPDATE user_channels SET shorts_feed_visibility='show' WHERE user_id=1 AND channel_id='UCportable'").run();
    const zip = await backup.createPortableBackup({ preset: "setup", profiles: [profile.id] });

    await setUserSetting(1, "show_shorts", "0");
    db.prepare("UPDATE user_channels SET shorts_feed_visibility='default' WHERE user_id=1 AND channel_id='UCportable'").run();

    const analyzed = await backup.analyzePortableBackup(1, zip);
    const mappings = { [profile.id]: { action: "merge" as const, targetProfileId: 1 } };
    const plan = await backup.planPortableRestore(1, analyzed.sessionId, {
      mappings,
      sections: analyzed.manifest.sections.map((section) => section.id),
      strategy: "merge",
    });
    await backup.commitPortableRestore(1, analyzed.sessionId, plan.planRevision);

    expect(getUserSetting(1, "show_shorts")).toBe("disabled");
    expect((db.prepare("SELECT shorts_feed_visibility FROM user_channels WHERE user_id=1 AND channel_id='UCportable'").get() as any)?.shorts_feed_visibility).toBe("show");
  });

  test("round-trips resume playback context with portable tag identifiers", async () => {
    const options = await backup.backupOptions();
    const profile = options.profiles[0];
    const tagUuid = crypto.randomUUID();
    const tagId = Number(db.prepare("INSERT INTO tags(name,color,user_id,portable_uuid) VALUES(?,?,1,?) RETURNING id").run("Portable resume tag", "#7c5cff", tagUuid).lastInsertRowid);
    const context = { version: 1, kind: "feed", tags: [tagId], showAll: false, sort: "arrival" };
    db.prepare(`INSERT INTO user_videos(user_id,video_id,playback_context_json) VALUES(1,'portable001',?)
      ON CONFLICT(user_id,video_id) DO UPDATE SET playback_context_json=excluded.playback_context_json`)
      .run(JSON.stringify(context));

    const zip = await backup.createPortableBackup({ preset: "full", profiles: [profile.id] });
    const entries = backup.readPortableZip(zip);
    const manifest = JSON.parse(decoder.decode(entries.get("manifest.json")!));
    const section = manifest.sections.find((item: any) => item.id === "profile.video-state" && item.profileId === profile.id);
    const exported = decoder.decode(entries.get(section.path)!).trim().split("\n").map((line) => JSON.parse(line))
      .find((row) => row.video_id === "portable001");
    expect(exported.playbackContext).toEqual({ version: 1, kind: "feed", tagUuids: [tagUuid], showAll: false, sort: "arrival" });
    expect(JSON.stringify(exported)).not.toContain(`\"tags\":[${tagId}]`);

    db.prepare("UPDATE user_videos SET playback_context_json=NULL WHERE user_id=1 AND video_id='portable001'").run();
    const analyzed = await backup.analyzePortableBackup(1, zip);
    const mappings = { [profile.id]: { action: "merge" as const, targetProfileId: 1 } };
    const plan = await backup.planPortableRestore(1, analyzed.sessionId, {
      mappings,
      sections: analyzed.manifest.sections.map((item) => item.id),
      strategy: "merge",
    });
    await backup.commitPortableRestore(1, analyzed.sessionId, plan.planRevision);

    const restored = db.prepare("SELECT playback_context_json FROM user_videos WHERE user_id=1 AND video_id='portable001'").get() as { playback_context_json: string };
    expect(JSON.parse(restored.playback_context_json)).toEqual(context);
  });

  test("configuration export excludes authentication values and runtime tables", async () => {
    setSetting("auth_oidc_client_secret", "DO-NOT-EXPORT-THIS");
    setSetting("auth_shared_password_hash", "HASH-DO-NOT-EXPORT");
    setSetting("auth_hide_other_profiles", "1");
    setSetting("child_lock_enabled", "1");
    setSetting("child_lock_pin_hash", "CHILD-PIN-HASH-DO-NOT-EXPORT");
    setSetting("profile_admin_only_areas", '["settings","profiles"]');
    db.prepare("UPDATE users SET oidc_subject = ?, is_admin = 1 WHERE id = 1").run("profile-identity-do-not-export@example.com");
    db.prepare("UPDATE channels SET feed_refresh_attempted_at = ?, feed_refresh_failures = ? WHERE channel_id = 'UCportable'")
      .run("2099-12-31 23:59:58", 987654321);
    db.prepare(`INSERT INTO channel_posts(post_id,channel_id,body,url) VALUES('cache-post-do-not-export','UCportable','COMMUNITY-CACHE-DO-NOT-EXPORT','https://youtube.com/post/cache-post-do-not-export')`).run();
    db.prepare(`INSERT INTO channel_post_sync_state(channel_id,last_attempted_at,last_success_at,last_error) VALUES('UCportable','2099-12-31T23:59:57.000Z','2099-12-31T23:59:57.000Z','POST-SYNC-ERROR-DO-NOT-EXPORT')`).run();
    const options = await backup.backupOptions();
    const zip = await backup.createPortableBackup({ preset: "configuration", profiles: options.profiles.map((profile) => profile.id) });
    const serialized = [...backup.readPortableZip(zip).values()].map((value) => new TextDecoder().decode(value)).join("\n");
    expect(serialized).not.toContain("DO-NOT-EXPORT-THIS");
    expect(serialized).not.toContain("HASH-DO-NOT-EXPORT");
    expect(serialized).not.toContain("auth_hide_other_profiles");
    expect(serialized).not.toContain("CHILD-PIN-HASH-DO-NOT-EXPORT");
    expect(serialized).not.toContain("child_lock_enabled");
    expect(serialized).toContain("profile_admin_only_areas");
    expect(serialized).toContain('\\\"appearance\\\",\\\"feed\\\",\\\"navigation\\\",\\\"playback\\\",\\\"profiles\\\"');
    expect(serialized).not.toContain("profile-identity-do-not-export@example.com");
    expect(serialized).not.toContain('"is_admin"');
    expect(serialized).not.toContain("2099-12-31 23:59:58");
    expect(serialized).not.toContain("987654321");
    expect(serialized).not.toContain("COMMUNITY-CACHE-DO-NOT-EXPORT");
    expect(serialized).not.toContain("POST-SYNC-ERROR-DO-NOT-EXPORT");
    expect(serialized).not.toContain("auth_sessions");
    expect(serialized).not.toContain("download_cookie");
  });

  test("round-trips the opt-in Watch together setting and accepts a v2 Social payload", async () => {
    const options = await backup.backupOptions();
    const profile = options.profiles[0];
    const adapter = plugins.PLUGIN_BACKUP_ADAPTERS.find((item) => item.id === "social" && item.scope === "instance");
    expect(adapter?.schemaVersion).toBe(3);
    if (!adapter) throw new Error("Social instance backup adapter is missing");

    try {
      await plugins.setPluginSettings(1, "social", { watch_together_enabled: 1 });
      const zip = await backup.createPortableBackup({ preset: "configuration", profiles: [profile.id] });
      const entries = backup.readPortableZip(zip);
      const manifest = JSON.parse(decoder.decode(entries.get("manifest.json")!));
      const instancePlugins = manifest.sections.find((section: any) => section.id === "instance.plugins");
      const rows = decoder.decode(entries.get(instancePlugins.path)!).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
      const socialRow = rows.find((row: any) => row.id === "social");
      expect(socialRow.schemaVersion).toBe(3);
      expect(socialRow.payload.settings.watch_together_enabled).toBe(1);

      await plugins.setPluginSettings(1, "social", { watch_together_enabled: 0 });
      const analyzed = await backup.analyzePortableBackup(1, zip);
      const mappings = { [profile.id]: { action: "merge" as const, targetProfileId: 1 } };
      const plan = await backup.planPortableRestore(1, analyzed.sessionId, { mappings, sections: analyzed.manifest.sections.map((section) => section.id), strategy: "merge" });
      await backup.commitPortableRestore(1, analyzed.sessionId, plan.planRevision);
      expect((await plugins.getPluginSettings(1, "social")).settings.watch_together_enabled).toBe(1);

      const legacyPayload = structuredClone(socialRow.payload);
      delete legacyPayload.settings.watch_together_enabled;
      await adapter.restore(1, legacyPayload);
      expect((await plugins.getPluginSettings(1, "social")).settings.watch_together_enabled).toBe(1);
    } finally {
      await plugins.setPluginSettings(1, "social", { watch_together_enabled: 0 });
    }
  });

  test("restores downloads settings from backups created before downloads became a core feature", async () => {
    const options = await backup.backupOptions();
    const profile = options.profiles[0];
    db.prepare("INSERT INTO download_settings(user_id,key,value) VALUES(1,'enabled','1'),(1,'compatible_format','1'),(1,'download_live_archives','1') ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value").run();
    const current = await backup.createPortableBackup({ preset: "configuration", profiles: [profile.id] });
    const legacy = await asLegacyDownloadsPluginArchive(current);
    db.prepare("UPDATE download_settings SET value='0' WHERE user_id=1 AND key IN ('enabled','compatible_format','download_live_archives')").run();
    const analyzed = await backup.analyzePortableBackup(1, legacy);
    const mappings = { [profile.id]: { action: "merge" as const, targetProfileId: 1 } };
    const plan = await backup.planPortableRestore(1, analyzed.sessionId, { mappings, sections: analyzed.manifest.sections.map((section) => section.id), strategy: "merge" });
    await backup.commitPortableRestore(1, analyzed.sessionId, plan.planRevision);
    expect(db.prepare("SELECT key,value FROM download_settings WHERE user_id=1 AND key IN ('enabled','compatible_format','download_live_archives') ORDER BY key").all())
      .toEqual([{ key: "compatible_format", value: "1" }, { key: "download_live_archives", value: "1" }, { key: "enabled", value: "1" }]);
  });

  test("round-trips the keep-downloads preference and defaults it for older payloads", async () => {
    const downloads = await import("./downloadBackup");
    const options = await backup.backupOptions();
    const profile = options.profiles[0];
    db.prepare("INSERT INTO download_settings(user_id,key,value) VALUES(1,'keep_downloads','1') ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value").run();
    const zip = await backup.createPortableBackup({ preset: "configuration", profiles: [profile.id] });
    const entries = backup.readPortableZip(zip);
    const manifest = JSON.parse(decoder.decode(entries.get("manifest.json")!));
    const section = manifest.sections.find((item: any) => item.id === "profile.downloads");
    expect(section.schemaVersion).toBe(4);
    expect(JSON.parse(decoder.decode(entries.get(section.path)!)).settings.keep_downloads).toBe(1);

    db.prepare("UPDATE download_settings SET value='0' WHERE user_id=1 AND key='keep_downloads'").run();
    await downloads.restoreDownloadPreferences(1, JSON.parse(decoder.decode(entries.get(section.path)!)));
    expect(db.prepare("SELECT value FROM download_settings WHERE user_id=1 AND key='keep_downloads'").get()).toEqual({ value: "1" });

    db.prepare("UPDATE download_settings SET value='1' WHERE user_id=1 AND key='keep_downloads'").run();
    await downloads.restoreDownloadPreferences(1, { settings: { retention_days: 30 } });
    expect(db.prepare("SELECT value FROM download_settings WHERE user_id=1 AND key='keep_downloads'").get()).toEqual({ value: "0" });
  });

  test("analyze is read-only and repeated merge restore is idempotent", async () => {
    const options = await backup.backupOptions();
    const profile = options.profiles[0];
    db.prepare("UPDATE channels SET manual_status='banned' WHERE channel_id='UCportable'").run();
    db.prepare(`UPDATE channels SET refresh_schedule_days='[1,3]', refresh_schedule_time='["08:02","18:02"]' WHERE channel_id='UCportable'`).run();
    setUserSetting(1, "player_screenshot_filename", "{title}_{timestamp_ms}");
    setUserSetting(1, "enhance_frame_fps", "60");
    setUserSetting(1, "feed_sort", "arrival");
    setUserSetting(1, "video_card_actions", "delay");
    const cardActionButtons = '{"version":1,"actions":[{"id":"playlist","hidden":false},{"id":"schedule","hidden":true},{"id":"download","hidden":false},{"id":"archive","hidden":false},{"id":"watched","hidden":false},{"id":"restore","hidden":false},{"id":"remove","hidden":false}]}';
    setUserSetting(1, "video_card_action_buttons", cardActionButtons);
    const cardSwipeDevices = '{"version":1,"devices":["desktop","tablet"]}';
    setUserSetting(1, "video_card_swipe_devices", cardSwipeDevices);
    setUserSetting(1, "video_card_preview", "downloaded");
    const keyboardShortcuts = '{"version":1,"bindings":{"togglePlay":"KeyX","toggleMute":null}}';
    setUserSetting(1, "keyboard_shortcuts", keyboardShortcuts);
    setUserSetting(1, "dearrow_titles_enabled", "1");
    setUserSetting(1, "dearrow_thumbnails_enabled", "1");
    setUserSetting(1, "child_watching_monitor_enabled", "0");
    setUserSetting(1, "channel_posts_tab", "1");
    db.prepare("INSERT INTO download_settings(user_id,key,value) VALUES(1,'enabled','1'),(1,'compatible_format','1'),(1,'download_live_archives','1'),(1,'prefetch_next_playlist_video','1'),(1,'download_schedule_enabled','1'),(1,'download_schedule_days','1,3,5'),(1,'download_schedule_start','23:00'),(1,'download_schedule_end','07:00') ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value").run();
    await setSetting("downloads_output_template", "portable/{id}");
    setSetting("profile_admin_only_areas", '["channels","plugins"]');
    setSetting("timezone", "Europe/London");
    const ruleUuid = crypto.randomUUID();
    db.prepare(`INSERT INTO download_rules(portable_uuid,user_id,name,source_mode,channel_ids_json,include_keywords_json,exclude_keywords_json,backfill_mode)
      VALUES(?, 1, 'Portable downloads', 'selected', '["UCportable"]', '["episode"]', '["trailer"]', 'all')`).run(ruleUuid);
    const playlistUuid = crypto.randomUUID();
    const playlist = db.prepare("INSERT INTO user_playlists(name,user_id,portable_uuid) VALUES('Portable playlist',1,?) RETURNING id").get(playlistUuid) as { id: number };
    db.prepare("INSERT INTO user_playlist_videos(playlist_id,video_id,added_at,position) VALUES(?,'portable001','2024-02-03 04:05:06',7)").run(playlist.id);
    const socialPostId = "64f616b4-fda8-4f31-a9da-5646bbf2a311";
    const socialCommentId = "15142485-66a7-4700-871f-173fd9be74d0";
    db.prepare("INSERT INTO social_posts(id,author_user_id,video_id,body) VALUES(?,1,'portable001','Sprawdź @Default')").run(socialPostId);
    db.prepare("INSERT INTO social_comments(id,post_id,author_user_id,body) VALUES(?,?,1,'Dobry film')").run(socialCommentId, socialPostId);
    db.prepare("INSERT INTO social_reactions(post_id,user_id,reaction_key) VALUES(?,1,'🤯')").run(socialPostId);
    db.prepare("INSERT INTO social_reactions(post_id,user_id,reaction_key) VALUES(?,1,'👨‍👩‍👧‍👦')").run(socialPostId);
    db.prepare("INSERT INTO social_recent_emojis(user_id,reaction_key,used_at) VALUES(1,'👨‍👩‍👧‍👦',2),(1,'🤯',1)").run();
    db.prepare("INSERT INTO plugin_state(plugin_id,user_id,key,value) VALUES('social',1,'emoji_skin_tone','1f3fd') ON CONFLICT(plugin_id,user_id,key) DO UPDATE SET value=excluded.value").run();
    db.prepare("INSERT INTO social_comment_likes(comment_id,user_id) VALUES(?,1)").run(socialCommentId);
    db.prepare("INSERT INTO social_post_mentions(post_id,mentioned_user_id,token) VALUES(?,1,'@Default')").run(socialPostId);
    const zip = await backup.createPortableBackup({ preset: "full", profiles: [profile.id] });
    const before = (db.prepare("SELECT count(*) n FROM history").get() as { n: number }).n;
    db.prepare("UPDATE channels SET manual_status='active' WHERE channel_id='UCportable'").run();
    db.prepare("UPDATE channels SET refresh_schedule_days=NULL, refresh_schedule_time=NULL WHERE channel_id='UCportable'").run();
    db.prepare("UPDATE channels SET external=1 WHERE channel_id='UCportable'").run();
    db.prepare("DELETE FROM user_channels WHERE user_id=1 AND channel_id='UCportable'").run();
    setUserSetting(1, "player_screenshot_filename", "changed");
    setUserSetting(1, "enhance_frame_fps", "24");
    setUserSetting(1, "feed_sort", "published");
    setUserSetting(1, "video_card_actions", "hover");
    setUserSetting(1, "video_card_action_buttons", SETTING_DEFAULTS.video_card_action_buttons);
    setUserSetting(1, "video_card_swipe_devices", SETTING_DEFAULTS.video_card_swipe_devices);
    setUserSetting(1, "video_card_preview", "off");
    setUserSetting(1, "keyboard_shortcuts", SETTING_DEFAULTS.keyboard_shortcuts);
    setUserSetting(1, "dearrow_titles_enabled", "0");
    setUserSetting(1, "dearrow_thumbnails_enabled", "0");
    setUserSetting(1, "child_watching_monitor_enabled", "1");
    setUserSetting(1, "channel_posts_tab", "0");
    db.prepare("DELETE FROM download_settings WHERE user_id=1 AND key IN ('compatible_format','download_live_archives','prefetch_next_playlist_video','download_schedule_enabled','download_schedule_days','download_schedule_start','download_schedule_end')").run();
    db.prepare("UPDATE download_settings SET value='0' WHERE user_id=1 AND key='enabled'").run();
    await setSetting("downloads_output_template", "changed/{id}");
    setSetting("profile_admin_only_areas", "[]");
    setSetting("timezone", "UTC");
    db.prepare("DELETE FROM download_rules WHERE portable_uuid=?").run(ruleUuid);
    db.prepare("DELETE FROM user_playlists WHERE portable_uuid=?").run(playlistUuid);
    db.prepare("DELETE FROM social_posts WHERE id=?").run(socialPostId);
    db.prepare("DELETE FROM social_recent_emojis WHERE user_id=1").run();
    db.prepare("DELETE FROM plugin_state WHERE plugin_id='social' AND user_id=1 AND key='emoji_skin_tone'").run();
    const analyzed = await backup.analyzePortableBackup(1, zip);
    expect((db.prepare("SELECT count(*) n FROM history").get() as { n: number }).n).toBe(before);
    const mappings = { [profile.id]: { action: "merge" as const, targetProfileId: 1 } };
    const plan = await backup.planPortableRestore(1, analyzed.sessionId, { mappings, sections: analyzed.manifest.sections.map((section) => section.id), strategy: "merge" });
    await backup.commitPortableRestore(1, analyzed.sessionId, plan.planRevision);
    const again = await backup.analyzePortableBackup(1, zip);
    const planAgain = await backup.planPortableRestore(1, again.sessionId, { mappings, sections: again.manifest.sections.map((section) => section.id), strategy: "merge" });
    await backup.commitPortableRestore(1, again.sessionId, planAgain.planRevision);
    expect((db.prepare("SELECT count(*) n FROM history WHERE user_id=1 AND video_id='portable001' AND watched_at='2026-07-25 10:00:00'").get() as { n: number }).n).toBe(1);
    expect(db.prepare("SELECT uc.followed, c.external FROM user_channels uc JOIN channels c USING(channel_id) WHERE uc.user_id=1 AND uc.channel_id='UCportable'").get()).toEqual({ followed: 1, external: 0 });
    expect((db.prepare("SELECT manual_status FROM channels WHERE channel_id='UCportable'").get() as { manual_status: string }).manual_status).toBe("banned");
    expect(db.prepare("SELECT refresh_schedule_days, refresh_schedule_time FROM channels WHERE channel_id='UCportable'").get()).toEqual({ refresh_schedule_days: "[1,3]", refresh_schedule_time: '["08:02","18:02"]' });
    expect(getUserSetting(1, "player_screenshot_filename")).toBe("{title}_{timestamp_ms}");
    expect(getUserSetting(1, "enhance_frame_fps")).toBe("60");
    expect(getUserSetting(1, "feed_sort")).toBe("arrival");
    expect(getUserSetting(1, "video_card_actions")).toBe("delay");
    expect(getUserSetting(1, "video_card_action_buttons")).toBe(videoCardActions.normalizeVideoCardActionConfig(cardActionButtons));
    expect(getUserSetting(1, "video_card_swipe_devices")).toBe(videoCardActions.normalizeVideoCardSwipeConfig(cardSwipeDevices));
    expect(getUserSetting(1, "video_card_preview")).toBe("downloaded");
    expect(getUserSetting(1, "keyboard_shortcuts")).toBe(keyboardShortcuts);
    expect(getUserSetting(1, "dearrow_titles_enabled")).toBe("1");
    expect(getUserSetting(1, "dearrow_thumbnails_enabled")).toBe("1");
    expect(getUserSetting(1, "child_watching_monitor_enabled")).toBe("0");
    expect(getUserSetting(1, "channel_posts_tab")).toBe("1");
    expect((db.prepare("SELECT value FROM download_settings WHERE user_id=1 AND key='compatible_format'").get() as { value: string }).value).toBe("1");
    expect((db.prepare("SELECT value FROM download_settings WHERE user_id=1 AND key='download_live_archives'").get() as { value: string }).value).toBe("1");
    expect((db.prepare("SELECT value FROM download_settings WHERE user_id=1 AND key='prefetch_next_playlist_video'").get() as { value: string }).value).toBe("1");
    expect(db.prepare("SELECT key,value FROM download_settings WHERE user_id=1 AND key IN ('download_schedule_days','download_schedule_enabled','download_schedule_end','download_schedule_start') ORDER BY key").all()).toEqual([
      { key: "download_schedule_days", value: "1,3,5" },
      { key: "download_schedule_enabled", value: "1" },
      { key: "download_schedule_end", value: "07:00" },
      { key: "download_schedule_start", value: "23:00" },
    ]);
    expect((db.prepare("SELECT value FROM download_settings WHERE user_id=1 AND key='enabled'").get() as { value: string }).value).toBe("1");
    expect(getSetting("downloads_output_template")).toBe("portable/{id}");
    expect((db.prepare("SELECT value FROM settings WHERE key='profile_admin_only_areas'").get() as { value: string }).value)
      .toBe(permissions.serializeAdminOnlyAreas(["channels", "followed_playlists", "imports", "plugins"]));
    expect(getSetting("timezone")).toBe("Europe/London");
    expect(db.prepare("SELECT name, include_keywords_json, exclude_keywords_json FROM download_rules WHERE portable_uuid=?").get(ruleUuid)).toEqual({ name: "Portable downloads", include_keywords_json: '["episode"]', exclude_keywords_json: '["trailer"]' });
    expect((db.prepare("SELECT COUNT(*) AS n FROM download_rules WHERE portable_uuid=?").get(ruleUuid) as { n: number }).n).toBe(1);
    expect(db.prepare(`SELECT upv.added_at,upv.position FROM user_playlist_videos upv
      JOIN user_playlists up ON up.id=upv.playlist_id WHERE up.portable_uuid=? AND upv.video_id='portable001'`).get(playlistUuid))
      .toEqual({ added_at: "2024-02-03 04:05:06", position: 7 });
    expect(db.prepare("SELECT body,video_id FROM social_posts WHERE id=?").get(socialPostId)).toEqual({ body: "Sprawdź @Default", video_id: "portable001" });
    expect((db.prepare("SELECT COUNT(*) AS n FROM social_comments WHERE id=?").get(socialCommentId) as { n: number }).n).toBe(1);
    expect((db.prepare("SELECT COUNT(*) AS n FROM social_reactions WHERE post_id=?").get(socialPostId) as { n: number }).n).toBe(2);
    expect((db.prepare("SELECT COUNT(*) AS n FROM social_comment_likes WHERE comment_id=?").get(socialCommentId) as { n: number }).n).toBe(1);
    expect((db.prepare("SELECT COUNT(*) AS n FROM social_post_mentions WHERE post_id=?").get(socialPostId) as { n: number }).n).toBe(1);
    expect((db.prepare("SELECT reaction_key FROM social_recent_emojis WHERE user_id=1 ORDER BY used_at DESC").all() as Array<{ reaction_key: string }>).map((row) => row.reaction_key)).toEqual(["👨‍👩‍👧‍👦", "🤯"]);
    expect((db.prepare("SELECT value FROM plugin_state WHERE plugin_id='social' AND user_id=1 AND key='emoji_skin_tone'").get() as { value: string }).value).toBe("1f3fd");
    const restoredAvatar = (db.prepare("SELECT avatar FROM users WHERE id=1").get() as { avatar: string }).avatar;
    expect(restoredAvatar).toContain("1.webp:optimized-webp-v1:");
    expect(existsSync(resolve(avatarDir, "1.png"))).toBe(false);
    const restoredMetadata = await sharp(resolve(avatarDir, "1.webp")).metadata();
    expect({ format: restoredMetadata.format, width: restoredMetadata.width, height: restoredMetadata.height }).toEqual({ format: "webp", width: 256, height: 256 });
  });
});
}
