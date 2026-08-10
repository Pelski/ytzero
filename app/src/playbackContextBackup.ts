import { database } from "./database";
import { parsePlaybackContext, type PlaybackContext } from "./playbackContext";

export type PortablePlaybackContext =
  | Omit<Extract<PlaybackContext, { kind: "feed" }>, "tags"> & { tagUuids: string[] }
  | Exclude<PlaybackContext, { kind: "feed" }>;

export async function exportPlaybackContext(userId: number, stored: unknown): Promise<PortablePlaybackContext | null> {
  const context = parsePlaybackContext(stored);
  if (!context) return null;
  if (context.kind !== "feed") return context;
  if (context.tags.length === 0) {
    const { tags: _tags, ...portable } = context;
    return { ...portable, tagUuids: [] };
  }
  const placeholders = context.tags.map(() => "?").join(",");
  const rows = await database.prepare(`SELECT id, portable_uuid FROM tags WHERE user_id=? AND id IN (${placeholders})`).all(userId, ...context.tags) as { id: number; portable_uuid: string }[];
  const uuids = new Map(rows.map((row) => [Number(row.id), row.portable_uuid]));
  if (context.tags.some((tag) => !uuids.has(tag))) return null;
  const { tags: _tags, ...portable } = context;
  return { ...portable, tagUuids: context.tags.map((tag) => uuids.get(tag)!) };
}

export async function restorePlaybackContext(userId: number, value: unknown, restoredTagIds: ReadonlyMap<string, number>): Promise<PlaybackContext | null> {
  if (!value || typeof value !== "object") return null;
  const portable = value as Record<string, unknown>;
  if (portable.kind === "feed") {
    if (!Array.isArray(portable.tagUuids) || !portable.tagUuids.every((uuid) => typeof uuid === "string")) return null;
    const tags = portable.tagUuids.map((uuid) => restoredTagIds.get(uuid));
    if (tags.some((tag) => tag == null)) return null;
    return parsePlaybackContext({ ...portable, tags, tagUuids: undefined });
  }
  const context = parsePlaybackContext(value);
  if (!context) return null;
  if (context.kind === "user-playlist" && !await database.prepare("SELECT 1 FROM user_playlists WHERE user_id=? AND portable_uuid=?").get(userId, context.playlistUuid)) return null;
  return context;
}
