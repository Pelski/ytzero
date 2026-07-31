import sharp from "sharp";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { basename, resolve } from "node:path";
import { database } from "./database";
import { log } from "./logger";

export const PROFILE_AVATAR_SIZE = 256;
export const PROFILE_AVATAR_MAX_INPUT_PIXELS = 40_000_000;
const OPTIMIZED_AVATAR_MARKER = "optimized-webp-v1";
export const PROFILE_AVATAR_DIR = process.env.AVATAR_DIR ?? resolve(import.meta.dir, "../../data/avatars");

export function profileAvatarFileName(token: string): string | null {
  const fileName = basename(token.split(":")[0] ?? "");
  return /^[1-9]\d*\.(?:png|jpe?g|webp)$/i.test(fileName) ? fileName : null;
}

export function optimizedProfileAvatarToken(profileId: number, changedAt = Date.now()): string {
  return `${profileId}.webp:${OPTIMIZED_AVATAR_MARKER}:${changedAt}`;
}

export function isOptimizedProfileAvatar(token: string): boolean {
  return token.includes(`:${OPTIMIZED_AVATAR_MARKER}:`);
}

export async function optimizeProfileAvatar(input: Uint8Array | ArrayBuffer): Promise<Uint8Array> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const output = await sharp(bytes, {
    failOn: "warning",
    limitInputPixels: PROFILE_AVATAR_MAX_INPUT_PIXELS,
  })
    .rotate()
    .resize(PROFILE_AVATAR_SIZE, PROFILE_AVATAR_SIZE, { fit: "cover", position: "centre" })
    .webp({ quality: 82, alphaQuality: 90, effort: 4, smartSubsample: true })
    .toBuffer();
  return new Uint8Array(output);
}

export async function stageOptimizedProfileAvatar(profileId: number, input: Uint8Array | ArrayBuffer, directory = PROFILE_AVATAR_DIR) {
  const bytes = await optimizeProfileAvatar(input);
  return stageProfileAvatarBytes(profileId, bytes, directory);
}

export async function stageProfileAvatarBytes(profileId: number, bytes: Uint8Array, directory = PROFILE_AVATAR_DIR) {
  mkdirSync(directory, { recursive: true });
  const fileName = `${profileId}.webp`;
  const stage = resolve(directory, `.${profileId}-${crypto.randomUUID()}.stage`);
  try {
    await Bun.write(stage, bytes);
  } catch (error) {
    rmSync(stage, { force: true });
    throw error;
  }
  return { bytes, fileName, stage, target: resolve(directory, fileName), token: optimizedProfileAvatarToken(profileId) };
}

export function commitStagedProfileAvatar(stage: string, target: string) {
  renameSync(stage, target);
}

export function removeStoredProfileAvatar(token: string, exceptFileName?: string, directory = PROFILE_AVATAR_DIR) {
  const fileName = profileAvatarFileName(token);
  if (fileName && fileName !== exceptFileName) rmSync(resolve(directory, fileName), { force: true });
}

/** Idempotently converts avatars written by older releases. The marker lives in
 * the existing cache-busting token, so no new persistent setting or schema is
 * needed and restored legacy avatars can be recognized on the next startup. */
export async function migrateLegacyProfileAvatars() {
  const rows = await database.prepare("SELECT id,avatar FROM users WHERE avatar != '' ORDER BY id").all() as Array<{ id: number; avatar: string }>;
  let converted = 0;
  let skipped = 0;
  for (const row of rows) {
    if (isOptimizedProfileAvatar(row.avatar)) continue;
    const previousFileName = profileAvatarFileName(row.avatar);
    const previousPath = previousFileName ? resolve(PROFILE_AVATAR_DIR, previousFileName) : "";
    if (!previousFileName || !existsSync(previousPath)) { skipped++; continue; }
    let staged: Awaited<ReturnType<typeof stageOptimizedProfileAvatar>> | null = null;
    try {
      staged = await stageOptimizedProfileAvatar(row.id, readFileSync(previousPath));
      commitStagedProfileAvatar(staged.stage, staged.target);
      await database.prepare("UPDATE users SET avatar=? WHERE id=? AND avatar=?").run(staged.token, row.id, row.avatar);
      removeStoredProfileAvatar(row.avatar, staged.fileName);
      converted++;
    } catch (error) {
      if (staged) rmSync(staged.stage, { force: true });
      skipped++;
      log.warn("profile.avatar_migration_failed", { profileId: row.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (converted || skipped) log.info("profile.avatar_migration", { converted, skipped });
  return { converted, skipped };
}
