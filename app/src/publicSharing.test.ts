import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { runIsolatedTestFile } from "../tests/isolatedTestFile";

const ISOLATION_FLAG = "YTZERO_PUBLIC_SHARING_TEST_ISOLATED";
if (process.env[ISOLATION_FLAG] !== "1") {
  test("public sharing suite runs in an isolated application runtime", async () => {
    await runIsolatedTestFile("src/publicSharing.test.ts", ISOLATION_FLAG);
  });
} else {
  const root = mkdtempSync(resolve(tmpdir(), "ytzero-public-sharing-"));
  process.env.DB_PATH = resolve(root, "db", "sharing.db");
  process.env.DOWNLOADS_DIR = resolve(root, "downloads");
  process.env.TUBE_ARCHIVIST_CONFIG_DIR = resolve(root, "tubearchivist");
  const uiDir = resolve(root, "ui");
  mkdirSync(uiDir, { recursive: true });
  writeFileSync(resolve(uiDir, "index.html"), "<!doctype html><title>Public share</title>");

  const { db } = await import("./db");
  const { ensureAccessControl } = await import("./accessControl");
  const sharing = await import("./publicSharing");
  const { createPublicShareRouter, PublicShareMediaLimiter, PublicShareRateLimiter } = await import("./routes/publicShareRoutes");

  await ensureAccessControl();

  db.prepare("INSERT INTO channels(channel_id,title,url,thumbnail) VALUES('UCshare','Public creator','https://youtube.com/channel/UCshare','https://yt3.ggpht.com/public-avatar')").run();
  db.prepare(`INSERT INTO videos(video_id,channel_id,title,description,thumbnail,published_at,duration,views,likes,is_private,is_unavailable,members_only)
    VALUES('public001','UCshare','Public video','Safe description','https://i.ytimg.com/vi/public001/hqdefault.jpg','2026-09-01T10:00:00.000Z','12:34',42,3,0,0,0)`).run();
  db.prepare("INSERT INTO videos(video_id,channel_id,title,is_private) VALUES('private001','UCshare','Private video',1)").run();
  db.prepare("INSERT INTO videos(video_id,channel_id,title,members_only) VALUES('members001','UCshare','Members video',1)").run();
  db.prepare("INSERT INTO user_channels(user_id,channel_id,followed) VALUES(1,'UCshare',1)").run();

  afterAll(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });

  describe("public share capability lifecycle", () => {
    test("starts disabled and generates independent 256-bit base64url tokens", async () => {
      expect(await sharing.publicSharingEnabled()).toBe(false);
      const tokens = new Set(Array.from({ length: 128 }, () => sharing.createPublicShareToken()));
      expect(tokens.size).toBe(128);
      for (const token of tokens) expect(token).toMatch(sharing.PUBLIC_SHARE_TOKEN_PATTERN);
    });

    test("validates ownership and dynamically filters private content", async () => {
      await sharing.setPublicSharingEnabled(true);
      const share = await sharing.createPublicShare(1, "video", "public001");
      expect((await sharing.createPublicShare(1, "video", "public001")).id).toBe(share.id);
      expect(await sharing.resolvePublicShare(share.token)).not.toBeNull();
      await expect(sharing.createPublicShare(1, "video", "private001")).rejects.toMatchObject({ code: "public_share_resource_unavailable" });
      await expect(sharing.createPublicShare(1, "video", "members001")).rejects.toMatchObject({ code: "public_share_resource_unavailable" });

      db.prepare("UPDATE videos SET is_private=1 WHERE video_id='public001'").run();
      expect(await sharing.resolvePublicShare(share.token)).toBeNull();
      db.prepare("UPDATE videos SET is_private=0 WHERE video_id='public001'").run();
      expect(await sharing.resolvePublicShare(share.token)).not.toBeNull();
    });

    test("suspends and restores a non-admin link with permission and ownership", async () => {
      const userId = Number(db.prepare("INSERT INTO users(name) VALUES('Publisher')").run().lastInsertRowid);
      db.prepare("INSERT INTO user_channels(user_id,channel_id,followed) VALUES(?,'UCshare',1)").run(userId);
      await expect(sharing.createPublicShare(userId, "video", "public001")).rejects.toMatchObject({ code: "public_sharing_permission_denied" });
      db.prepare("INSERT INTO profile_permission_overrides(user_id,permission,allowed) VALUES(?,'public_sharing',1)").run(userId);
      const share = await sharing.createPublicShare(userId, "video", "public001");
      expect(await sharing.resolvePublicShare(share.token)).not.toBeNull();

      db.prepare("DELETE FROM profile_permission_overrides WHERE user_id=? AND permission='public_sharing'").run(userId);
      expect(await sharing.resolvePublicShare(share.token)).toBeNull();
      db.prepare("INSERT INTO profile_permission_overrides(user_id,permission,allowed) VALUES(?,'public_sharing',1)").run(userId);
      expect(await sharing.resolvePublicShare(share.token)).not.toBeNull();

      db.prepare("DELETE FROM user_channels WHERE user_id=? AND channel_id='UCshare'").run(userId);
      expect(await sharing.resolvePublicShare(share.token)).toBeNull();
      db.prepare("INSERT INTO user_channels(user_id,channel_id,followed) VALUES(?,'UCshare',1)").run(userId);
      expect(await sharing.resolvePublicShare(share.token)).not.toBeNull();
    });

    test("keeps playlists live and filters disallowed members", async () => {
      const playlistId = Number(db.prepare("INSERT INTO user_playlists(name,user_id) VALUES('Shared list',1)").run().lastInsertRowid);
      db.prepare("INSERT INTO user_playlist_videos(playlist_id,video_id,position) VALUES(?,'public001',0),(?,'private001',1)").run(playlistId, playlistId);
      const personal = await sharing.createPublicShare(1, "user_playlist", String(playlistId));
      expect(await sharing.publicShareVideoIds(personal, 0)).toEqual(["public001"]);
      db.prepare("DELETE FROM user_playlist_videos WHERE playlist_id=? AND video_id='public001'").run(playlistId);
      expect(await sharing.publicShareVideoIds(personal, 0)).toEqual([]);
      db.prepare("INSERT INTO user_playlist_videos(playlist_id,video_id,position) VALUES(?,'public001',0)").run(playlistId);
      expect(await sharing.publicShareVideoIds(personal, 0)).toEqual(["public001"]);

      db.prepare("DELETE FROM user_playlists WHERE id=?").run(playlistId);
      expect(await sharing.resolvePublicShare(personal.token)).toBeNull();
      expect(await sharing.managedPublicShare(personal.id)).toBeNull();

      db.prepare("INSERT INTO channel_playlists(playlist_id,channel_id,title) VALUES('PLshare','UCshare','Followed list')").run();
      db.prepare("INSERT INTO channel_playlist_videos(playlist_id,video_id,position) VALUES('PLshare','public001',0)").run();
      db.prepare("INSERT INTO user_followed_playlists(user_id,playlist_id) VALUES(1,'PLshare')").run();
      const followed = await sharing.createPublicShare(1, "followed_playlist", "PLshare");
      expect(await sharing.resolvePublicShare(followed.token)).not.toBeNull();
      db.prepare("DELETE FROM user_followed_playlists WHERE user_id=1 AND playlist_id='PLshare'").run();
      expect(await sharing.resolvePublicShare(followed.token)).toBeNull();
      db.prepare("INSERT INTO user_followed_playlists(user_id,playlist_id) VALUES(1,'PLshare')").run();
      expect(await sharing.resolvePublicShare(followed.token)).not.toBeNull();
    });

    test("rotates when local media is enabled and revokes permanently", async () => {
      const current = await sharing.createPublicShare(1, "video", "public001");
      const enabled = await sharing.updatePublicShareLocalMedia(current.id, true);
      expect(enabled.rotated).toBe(true);
      expect(enabled.share?.token).not.toBe(current.token);
      expect(await sharing.resolvePublicShare(current.token)).toBeNull();
      expect(await sharing.resolvePublicShare(enabled.share!.token)).not.toBeNull();
      const disabled = await sharing.updatePublicShareLocalMedia(current.id, false);
      expect(disabled.rotated).toBe(false);
      expect(disabled.share?.token).toBe(enabled.share?.token);
      expect(await sharing.deletePublicShare(current.id)).toBe(true);
      expect(await sharing.resolvePublicShare(enabled.share!.token)).toBeNull();
    });
  });

  describe("public route security", () => {
    test("returns only the allowlisted projection with hardening headers", async () => {
      const share = await sharing.createPublicShare(1, "video", "public001");
      const router = createPublicShareRouter(uiDir);
      const response = await router.request(`http://localhost/${share.token}/data`);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(response.headers.get("x-robots-tag")).toContain("noindex");
      expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
      const body = await response.json() as Record<string, unknown>;
      expect(body.brand).toEqual({ name: "YT Zero", icon: "/favicon.svg", color: "#0a5fff" });
      expect(JSON.stringify(body)).not.toContain("owner_user_id");
      expect(JSON.stringify(body)).not.toContain("Publisher");
      expect((body.creators as Array<{ avatar: string }>)[0]?.avatar).toBe(`/share/${share.token}/avatar/public001/UCshare`);
      expect(JSON.stringify(body)).not.toContain("https://yt3.ggpht.com/public-avatar");
      expect(body).not.toHaveProperty("comments");
      expect(body).not.toHaveProperty("transcript");

      await sharing.setPublicSharingEnabled(false);
      const suspended = await router.request(`http://localhost/${share.token}/data`);
      const invalid = await router.request("http://localhost/not-a-valid-token/data");
      expect(suspended.status).toBe(404);
      expect(await suspended.text()).toBe(await invalid.text());
      await sharing.setPublicSharingEnabled(true);
    });

    test("validates a video route before returning the public application shell", async () => {
      const share = await sharing.createPublicShare(1, "video", "public001");
      const router = createPublicShareRouter(uiDir);
      expect((await router.request(`http://localhost/${share.token}`)).status).toBe(200);
      expect((await router.request(`http://localhost/${share.token}/video/public001`)).status).toBe(200);
      expect((await router.request(`http://localhost/${share.token}/video/private001`)).status).toBe(404);
    });

    test("enforces the lightweight-request burst and refill", () => {
      let now = 0;
      const limiter = new PublicShareRateLimiter(() => now);
      for (let index = 0; index < 30; index++) expect(limiter.take("ip:token").allowed).toBe(true);
      expect(limiter.take("ip:token")).toMatchObject({ allowed: false, retryAfter: 1 });
      now += 500;
      expect(limiter.take("ip:token").allowed).toBe(true);
    });

    test("holds no more than four media leases per token", () => {
      const limiter = new PublicShareMediaLimiter();
      const leases = Array.from({ length: 4 }, () => limiter.acquire("token"));
      expect(leases.every(Boolean)).toBe(true);
      expect(limiter.acquire("token")).toBeNull();
      leases[0]?.();
      expect(limiter.acquire("token")).toBeFunction();
    });
  });
}
