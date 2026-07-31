import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import sharp from "sharp";

const root = mkdtempSync(resolve(tmpdir(), "ytzero-profile-avatars-"));
const avatarDir = resolve(root, "avatars");
process.env.DB_PATH = resolve(root, "db", "source.db");
process.env.AVATAR_DIR = avatarDir;

const { db } = await import("./db");
const avatars = await import("./profileAvatars");
const { api } = await import("./routes");

beforeAll(async () => {
  mkdirSync(avatarDir, { recursive: true });
  const legacy = await sharp({ create: { width: 1400, height: 700, channels: 3, background: { r: 218, g: 72, b: 88 } } }).jpeg({ quality: 96 }).toBuffer();
  writeFileSync(resolve(avatarDir, "1.jpg"), legacy);
  db.prepare("UPDATE users SET avatar='1.jpg:legacy-token' WHERE id=1").run();
  db.prepare("INSERT INTO users(name,avatar_color) VALUES('Avatar upload','#336699')").run();
});

afterAll(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

describe("profile avatar optimization", () => {
  test("rejects content that is not a decodable image", async () => {
    expect(avatars.optimizeProfileAvatar(new TextEncoder().encode("not an image"))).rejects.toThrow();
  });

  test("migrates a legacy image once to a square WebP", async () => {
    expect(await avatars.migrateLegacyProfileAvatars()).toEqual({ converted: 1, skipped: 0 });
    const token = (db.prepare("SELECT avatar FROM users WHERE id=1").get() as { avatar: string }).avatar;
    expect(token).toContain("1.webp:optimized-webp-v1:");
    expect(existsSync(resolve(avatarDir, "1.jpg"))).toBe(false);
    const metadata = await sharp(resolve(avatarDir, "1.webp")).metadata();
    expect({ format: metadata.format, width: metadata.width, height: metadata.height }).toEqual({ format: "webp", width: 256, height: 256 });
    expect(await avatars.migrateLegacyProfileAvatars()).toEqual({ converted: 0, skipped: 0 });
  });

  test("normalizes uploads and serves them with immutable private caching", async () => {
    const profile = db.prepare("SELECT id FROM users WHERE name='Avatar upload'").get() as { id: number };
    const source = await sharp({ create: { width: 1800, height: 900, channels: 3, background: { r: 42, g: 168, b: 112 } } }).png().toBuffer();
    const form = new FormData();
    form.append("file", new File([new Uint8Array(source)], "large-avatar.png", { type: "image/png" }));
    const uploaded = await api.request(`http://localhost/profiles/${profile.id}/avatar`, {
      method: "POST",
      headers: { Cookie: "ytzero_profile=1" },
      body: form,
    });
    expect(uploaded.status).toBe(200);
    const token = (db.prepare("SELECT avatar FROM users WHERE id=?").get(profile.id) as { avatar: string }).avatar;
    expect(token).toContain(`${profile.id}.webp:optimized-webp-v1:`);

    const served = await api.request(`http://localhost/profiles/${profile.id}/avatar?v=${encodeURIComponent(token)}`, {
      headers: { Cookie: "ytzero_profile=1" },
    });
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/webp");
    expect(served.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    const bytes = new Uint8Array(await served.arrayBuffer());
    expect(Number(served.headers.get("content-length"))).toBe(bytes.length);
    const metadata = await sharp(bytes).metadata();
    expect({ format: metadata.format, width: metadata.width, height: metadata.height }).toEqual({ format: "webp", width: 256, height: 256 });

    const removed = await api.request(`http://localhost/profiles/${profile.id}/avatar`, {
      method: "DELETE",
      headers: { Cookie: "ytzero_profile=1" },
    });
    expect(removed.status).toBe(200);
    expect(existsSync(resolve(avatarDir, `${profile.id}.webp`))).toBe(false);
  });
});
