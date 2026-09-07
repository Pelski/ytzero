import { database } from "./database";

export const NOTIFICATION_CATEGORIES = [
  "channel_video",
  "playlist_video",
  "tag_rule",
  "download_failed",
  "social",
  "app_update",
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
export type NotificationSourceType = "channel" | "playlist" | "tag_rule";

export const NOTIFICATION_SOURCE_TYPES: readonly NotificationSourceType[] = ["channel", "playlist", "tag_rule"];

export const NOTIFICATION_CATEGORY_DEFAULTS: Record<NotificationCategory, boolean> = {
  // Channel-upload and tag-rule notifications are opt-in: both can fire on every
  // discovered video. Existing notification types retain their historical
  // enabled behaviour.
  channel_video: false,
  playlist_video: true,
  tag_rule: false,
  download_failed: true,
  social: true,
  app_update: true,
};

// Categories whose notifications are attributed to an individual source
// (a channel, a followed playlist, or one auto-tag rule) and therefore support
// per-source overrides in `notification_preferences.source_id`.
export const NOTIFICATION_SOURCE_KINDS: readonly NotificationCategory[] = ["channel_video", "playlist_video", "tag_rule"];

export function notificationCategory(kind: string): NotificationCategory | string {
  return kind.startsWith("social_") ? "social" : kind;
}

export function sourceKind(sourceType: NotificationSourceType): NotificationCategory {
  if (sourceType === "channel") return "channel_video";
  return sourceType === "playlist" ? "playlist_video" : "tag_rule";
}

export function sourceTypeOf(kind: string): NotificationSourceType | null {
  if (kind === "channel_video") return "channel";
  if (kind === "playlist_video") return "playlist";
  return kind === "tag_rule" ? "tag_rule" : null;
}

function defaultEnabled(kind: string): boolean {
  return NOTIFICATION_CATEGORY_DEFAULTS[kind as NotificationCategory] ?? true;
}

export async function notificationEnabled(userId: number, kind: string, sourceId = ""): Promise<boolean> {
  const category = notificationCategory(kind);
  const rows = await database.prepare(`
    SELECT kind, source_id, enabled
    FROM notification_preferences
    WHERE user_id = ? AND (
      (kind = '*' AND source_id = '')
      OR (kind = ? AND source_id = '')
      OR (kind = ? AND source_id = ?)
    )
  `).all<{ kind: string; source_id: string; enabled: number }>(userId, category, category, sourceId);
  const values = new Map(rows.map((row) => [`${row.kind}:${row.source_id}`, row.enabled === 1]));
  if (values.get("*:") === false) return false;
  if (sourceId && values.has(`${category}:${sourceId}`)) return values.get(`${category}:${sourceId}`)!;
  return values.get(`${category}:`) ?? defaultEnabled(category);
}

export async function setNotificationPreference(userId: number, kind: string, sourceId: string, enabled: boolean | null): Promise<void> {
  if (enabled === null) {
    await database.prepare("DELETE FROM notification_preferences WHERE user_id=? AND kind=? AND source_id=?")
      .run(userId, kind, sourceId);
    return;
  }
  await database.prepare(`
    INSERT INTO notification_preferences(user_id,kind,source_id,enabled)
    VALUES(?,?,?,?)
    ON CONFLICT(user_id,kind,source_id) DO UPDATE SET enabled=excluded.enabled
  `).run(userId, kind, sourceId, enabled ? 1 : 0);
}

export async function notificationPreferenceSnapshot(userId: number) {
  const rows = await database.prepare("SELECT kind,source_id,enabled FROM notification_preferences WHERE user_id=?")
    .all<{ kind: string; source_id: string; enabled: number }>(userId);
  const values = new Map(rows.map((row) => [`${row.kind}:${row.source_id}`, row.enabled === 1]));
  const enabled = values.get("*:") ?? true;
  const categories = Object.fromEntries(NOTIFICATION_CATEGORIES.map((kind) => [kind, values.get(`${kind}:`) ?? NOTIFICATION_CATEGORY_DEFAULTS[kind]]));
  const overrides = rows
    .flatMap((row) => {
      const sourceType = row.source_id ? sourceTypeOf(row.kind) : null;
      return sourceType ? [{ sourceType, sourceId: row.source_id, enabled: row.enabled === 1 }] : [];
    });
  return { enabled, categories, overrides };
}
