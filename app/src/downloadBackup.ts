import { database } from "./database";
import { DOWNLOADS_ADMIN_SETTING_KEYS, downloadSettings, profileDownloadsEnabled, setDownloadSettings, setProfileDownloadsEnabled } from "./downloadConfig";
import { listDownloadRules, restoreDownloadRules } from "./downloadRules";

export const DOWNLOAD_INSTANCE_BACKUP_SCHEMA_VERSION = 1;
export const DOWNLOAD_PROFILE_BACKUP_SCHEMA_VERSION = 3;

export async function exportDownloadInstanceSettings() {
  const settings = (await downloadSettings(0)).settings;
  return { settings: Object.fromEntries(Object.entries(settings).filter(([key]) => DOWNLOADS_ADMIN_SETTING_KEYS.has(key))) };
}

export async function restoreDownloadInstanceSettings(value: unknown): Promise<void> {
  const input = value && typeof value === "object" ? value as any : {};
  await setDownloadSettings(0, Object.fromEntries(Object.entries(input.settings ?? {}).filter(([key]) => DOWNLOADS_ADMIN_SETTING_KEYS.has(key))));
}

export async function exportDownloadPreferences(userId: number) {
  const rules = await listDownloadRules(userId);
  const playlistIds = [...new Set(rules.flatMap((rule) => rule.playlist_ids))];
  const playlists = playlistIds.length
    ? await database.prepare(`SELECT playlist_id, channel_id, title, thumbnail, video_count FROM channel_playlists WHERE playlist_id IN (${playlistIds.map(() => "?").join(",")})`).all(...playlistIds)
    : [];
  const allSettings = (await downloadSettings(userId)).settings;
  const settings = Object.fromEntries(Object.entries(allSettings).filter(([key]) => !DOWNLOADS_ADMIN_SETTING_KEYS.has(key)));
  return { enabled: await profileDownloadsEnabled(userId), settings, rules, playlists };
}

/** Restores both current profile.downloads documents and the former
 * plugins.downloads payload embedded in profile.settings. */
export async function restoreDownloadPreferences(userId: number, value: unknown, legacyEnabled?: boolean): Promise<void> {
  const input = value && typeof value === "object" ? value as any : {};
  await setDownloadSettings(userId, input.settings ?? {});
  if (typeof input.enabled === "boolean") await setProfileDownloadsEnabled(userId, input.enabled);
  else if (typeof legacyEnabled === "boolean") await setProfileDownloadsEnabled(userId, legacyEnabled);
  for (const playlist of Array.isArray(input.playlists) ? input.playlists : []) {
    if (!playlist?.playlist_id || !playlist?.channel_id) continue;
    await database.prepare("INSERT INTO channels(channel_id,title,url,external) VALUES(?,?,?,1) ON CONFLICT(channel_id) DO NOTHING").run(playlist.channel_id, "", "");
    await database.prepare("INSERT INTO channel_playlists(playlist_id,channel_id,title,thumbnail,video_count) VALUES(?,?,?,?,?) ON CONFLICT(playlist_id) DO UPDATE SET title=excluded.title,thumbnail=excluded.thumbnail,video_count=excluded.video_count")
      .run(playlist.playlist_id, playlist.channel_id, String(playlist.title ?? ""), String(playlist.thumbnail ?? ""), String(playlist.video_count ?? ""));
  }
  await restoreDownloadRules(userId, input.rules);
}
