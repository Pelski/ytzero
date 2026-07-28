import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = mkdtempSync(resolve(tmpdir(), "ytzero-portable-backup-"));
process.env.DB_PATH = resolve(root, "db", "source.db");
process.env.RESTORE_SESSION_DIR = resolve(root, "sessions");
process.env.AVATAR_DIR = resolve(root, "avatars");

const backup = await import("./portableBackup");
const permissions = await import("./profilePermissions");
const { db, setSetting, setUserSetting, getSetting, getUserSetting } = await import("./db");

beforeAll(() => {
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

  test("configuration export excludes authentication values and runtime tables", async () => {
    setSetting("auth_oidc_client_secret", "DO-NOT-EXPORT-THIS");
    setSetting("auth_shared_password_hash", "HASH-DO-NOT-EXPORT");
    setSetting("child_lock_enabled", "1");
    setSetting("child_lock_pin_hash", "CHILD-PIN-HASH-DO-NOT-EXPORT");
    setSetting("profile_admin_only_areas", '["settings","profiles"]');
    db.prepare("UPDATE users SET oidc_subject = ? WHERE id = 1").run("profile-identity-do-not-export@example.com");
    db.prepare("UPDATE channels SET feed_refresh_attempted_at = ?, feed_refresh_failures = ? WHERE channel_id = 'UCportable'")
      .run("2099-12-31 23:59:58", 987654321);
    const options = await backup.backupOptions();
    const zip = await backup.createPortableBackup({ preset: "configuration", profiles: options.profiles.map((profile) => profile.id) });
    const serialized = [...backup.readPortableZip(zip).values()].map((value) => new TextDecoder().decode(value)).join("\n");
    expect(serialized).not.toContain("DO-NOT-EXPORT-THIS");
    expect(serialized).not.toContain("HASH-DO-NOT-EXPORT");
    expect(serialized).not.toContain("CHILD-PIN-HASH-DO-NOT-EXPORT");
    expect(serialized).not.toContain("child_lock_enabled");
    expect(serialized).toContain("profile_admin_only_areas");
    expect(serialized).toContain('\\\"appearance\\\",\\\"feed\\\",\\\"navigation\\\",\\\"playback\\\",\\\"profiles\\\"');
    expect(serialized).not.toContain("profile-identity-do-not-export@example.com");
    expect(serialized).not.toContain("2099-12-31 23:59:58");
    expect(serialized).not.toContain("987654321");
    expect(serialized).not.toContain("auth_sessions");
    expect(serialized).not.toContain("download_cookie");
  });

  test("analyze is read-only and repeated merge restore is idempotent", async () => {
    const options = await backup.backupOptions();
    const profile = options.profiles[0];
    db.prepare("UPDATE channels SET manual_status='banned' WHERE channel_id='UCportable'").run();
    db.prepare(`UPDATE channels SET refresh_schedule_days='[1,3]', refresh_schedule_time='["08:02","18:02"]' WHERE channel_id='UCportable'`).run();
    setUserSetting(1, "player_screenshot_filename", "{title}_{timestamp_ms}");
    setUserSetting(1, "enhance_frame_fps", "60");
    setUserSetting(1, "feed_sort", "arrival");
    setSetting("profile_admin_only_areas", '["channels","plugins"]');
    setSetting("timezone", "Europe/London");
    const ruleUuid = crypto.randomUUID();
    db.prepare(`INSERT INTO download_rules(portable_uuid,name,source_mode,channel_ids_json,include_keywords_json,exclude_keywords_json,backfill_mode)
      VALUES(?, 'Portable downloads', 'selected', '["UCportable"]', '["episode"]', '["trailer"]', 'all')`).run(ruleUuid);
    const zip = await backup.createPortableBackup({ preset: "full", profiles: [profile.id] });
    const before = (db.prepare("SELECT count(*) n FROM history").get() as { n: number }).n;
    db.prepare("UPDATE channels SET manual_status='active' WHERE channel_id='UCportable'").run();
    db.prepare("UPDATE channels SET refresh_schedule_days=NULL, refresh_schedule_time=NULL WHERE channel_id='UCportable'").run();
    db.prepare("UPDATE channels SET external=1 WHERE channel_id='UCportable'").run();
    db.prepare("DELETE FROM user_channels WHERE user_id=1 AND channel_id='UCportable'").run();
    setUserSetting(1, "player_screenshot_filename", "changed");
    setUserSetting(1, "enhance_frame_fps", "24");
    setUserSetting(1, "feed_sort", "published");
    setSetting("profile_admin_only_areas", "[]");
    setSetting("timezone", "UTC");
    db.prepare("DELETE FROM download_rules WHERE portable_uuid=?").run(ruleUuid);
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
    expect((db.prepare("SELECT value FROM settings WHERE key='profile_admin_only_areas'").get() as { value: string }).value)
      .toBe(permissions.serializeAdminOnlyAreas(["channels", "followed_playlists", "imports", "plugins"]));
    expect(getSetting("timezone")).toBe("Europe/London");
    expect(db.prepare("SELECT name, include_keywords_json, exclude_keywords_json FROM download_rules WHERE portable_uuid=?").get(ruleUuid)).toEqual({ name: "Portable downloads", include_keywords_json: '["episode"]', exclude_keywords_json: '["trailer"]' });
    expect((db.prepare("SELECT COUNT(*) AS n FROM download_rules WHERE portable_uuid=?").get(ruleUuid) as { n: number }).n).toBe(1);
  });
});
