import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = mkdtempSync(resolve(tmpdir(), "ytzero-portable-backup-"));
process.env.DB_PATH = resolve(root, "db", "source.db");
process.env.RESTORE_SESSION_DIR = resolve(root, "sessions");
process.env.AVATAR_DIR = resolve(root, "avatars");

const backup = await import("./portableBackup");
const { db, setSetting } = await import("./db");

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
  test("registry contains no secret section", () => {
    expect(backup.BACKUP_SECTIONS.some((section) => section.sensitivity === "secret")).toBe(false);
    expect(backup.backupOptions().exclusions.join(" ")).toContain("passkeys");
  });

  test("configuration export excludes authentication values and runtime tables", async () => {
    setSetting("auth_oidc_client_secret", "DO-NOT-EXPORT-THIS");
    setSetting("auth_shared_password_hash", "HASH-DO-NOT-EXPORT");
    const options = backup.backupOptions();
    const zip = await backup.createPortableBackup({ preset: "configuration", profiles: options.profiles.map((profile) => profile.id) });
    const serialized = [...backup.readPortableZip(zip).values()].map((value) => new TextDecoder().decode(value)).join("\n");
    expect(serialized).not.toContain("DO-NOT-EXPORT-THIS");
    expect(serialized).not.toContain("HASH-DO-NOT-EXPORT");
    expect(serialized).not.toContain("auth_sessions");
    expect(serialized).not.toContain("download_cookie");
  });

  test("portable channel data excludes network-derived availability cache", async () => {
    db.prepare("UPDATE channels SET availability_status='unavailable', unavailable_reason='do-not-export', unavailable_at=datetime('now') WHERE channel_id='UCportable'").run();
    const options = backup.backupOptions();
    const zip = await backup.createPortableBackup({ preset: "full", profiles: options.profiles.map((profile) => profile.id) });
    const serialized = [...backup.readPortableZip(zip).values()].map((value) => new TextDecoder().decode(value)).join("\n");
    expect(serialized).not.toContain("do-not-export");
    expect(serialized).not.toContain("availability_status");
    db.prepare("UPDATE channels SET availability_status='available', unavailable_reason=NULL, unavailable_at=NULL WHERE channel_id='UCportable'").run();
  });

  test("analyze is read-only and repeated merge restore is idempotent", async () => {
    const options = backup.backupOptions();
    const profile = options.profiles[0];
    const zip = await backup.createPortableBackup({ preset: "full", profiles: [profile.id] });
    const before = (db.prepare("SELECT count(*) n FROM history").get() as { n: number }).n;
    db.prepare("UPDATE channels SET external=1 WHERE channel_id='UCportable'").run();
    db.prepare("DELETE FROM user_channels WHERE user_id=1 AND channel_id='UCportable'").run();
    const analyzed = await backup.analyzePortableBackup(1, zip);
    expect((db.prepare("SELECT count(*) n FROM history").get() as { n: number }).n).toBe(before);
    const mappings = { [profile.id]: { action: "merge" as const, targetProfileId: 1 } };
    const plan = backup.planPortableRestore(1, analyzed.sessionId, { mappings, sections: analyzed.manifest.sections.map((section) => section.id), strategy: "merge" });
    await backup.commitPortableRestore(1, analyzed.sessionId, plan.planRevision);
    const again = await backup.analyzePortableBackup(1, zip);
    const planAgain = backup.planPortableRestore(1, again.sessionId, { mappings, sections: again.manifest.sections.map((section) => section.id), strategy: "merge" });
    await backup.commitPortableRestore(1, again.sessionId, planAgain.planRevision);
    expect((db.prepare("SELECT count(*) n FROM history WHERE user_id=1 AND video_id='portable001' AND watched_at='2026-07-25 10:00:00'").get() as { n: number }).n).toBe(1);
    expect(db.prepare("SELECT uc.followed, c.external FROM user_channels uc JOIN channels c USING(channel_id) WHERE uc.user_id=1 AND uc.channel_id='UCportable'").get()).toEqual({ followed: 1, external: 0 });
  });
});
