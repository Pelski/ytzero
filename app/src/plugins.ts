import { database } from "./database";
import { getSetting, reloadSettingCache } from "./db";
import { classifyIsShort, fetchChannelAbout, fetchVideoInfo, searchYouTube, type SearchResult, type VideoInfo } from "./youtube";
import { buildKeywordPlan, tokenizeDiscoveryText, type KeywordSeed } from "./discoveryKeywords";
import { resetDownloadsState } from "./downloader";
import { maintenanceActive } from "./maintenance";
import { log } from "./logger";
import { storedUtcTimestampMs, zonedDayHour } from "./timeZone";
import { listDownloadRules, restoreDownloadRules } from "./downloadRules";
import { effectiveVideoTagsCte } from "./insightTags";
import { followedExists, followedPlaylistExists } from "./feedQueryFragments";
import { normalizeSocialEmojiSkinTone, normalizeSocialReaction } from "./social";
import {
  diversifyRecommendations,
  isEligibleRecommendation,
  recommendationHoursNear,
  recommendationProgress,
  recommendationTimeOfDay,
  scoreRecommendationCandidate,
  type RecommendationTimeOfDay,
} from "./recommendationRanking";
import {
  DISCOVERY_SETTINGS,
  DOWNLOADS_ADMIN_SETTING_KEYS,
  DOWNLOADS_SETTINGS,
  PLUGINS,
  PLUGIN_TEXT,
  SOCIAL_SETTINGS,
  type LocalizedText,
  type PluginLanguage,
  type PluginManifest,
  type PluginSettingDef,
  type PluginSettingSource,
  type PluginSettingValue,
  type PluginTermState,
} from "./pluginCatalog";
export { DOWNLOADS_ADMIN_SETTING_KEYS, PLUGINS } from "./pluginCatalog";
export type { PluginManifest, PluginSettingDef, PluginSettingOption, PluginSettingType, PluginSettingValue, PluginTermState } from "./pluginCatalog";

for (const plugin of PLUGINS) {
  await database.prepare("INSERT OR IGNORE INTO plugins (id, enabled, version) VALUES (?, ?, ?)")
    .run(plugin.id, 0, plugin.version);
  await database.prepare("UPDATE plugins SET version = ? WHERE id = ?").run(plugin.version, plugin.id);
}

// Social reactions are now arbitrary emoji; the former global allow-list is
// obsolete and must not silently return through an old installation backup.
if (getSetting("plugin_social_enabled_reactions") != null) {
  await database.prepare("DELETE FROM settings WHERE key='plugin_social_enabled_reactions'").run();
  await reloadSettingCache();
}

// Seamless migration from the former instance-wide downloads configuration.
// Existing profile-level preferences are copied to every current profile;
// physical-store settings remain global. New profiles simply use defaults.
if (getSetting("downloads_profile_settings_migrated") !== "1") {
  const users = await database.prepare("SELECT id FROM users").all() as { id: number }[];
  const downloadPluginRow = await database.prepare("SELECT enabled FROM plugins WHERE id='downloads'").get() as { enabled: number } | null;
  const enabled = downloadPluginRow?.enabled === 1 ? "1" : "0";
  const tx = database.transaction(async () => {
    for (const user of users) {
      await database.prepare("INSERT OR IGNORE INTO plugin_settings (plugin_id, user_id, key, value) VALUES ('downloads', ?, 'profile_enabled', ?)")
        .run(user.id, enabled);
      for (const def of DOWNLOADS_SETTINGS) {
        if (DOWNLOADS_ADMIN_SETTING_KEYS.has(def.key)) continue;
        const legacy = getSetting(`plugin_downloads_${def.key}`);
        if (legacy == null) continue;
        await database.prepare("INSERT OR IGNORE INTO plugin_settings (plugin_id, user_id, key, value) VALUES ('downloads', ?, ?, ?)")
          .run(user.id, def.key, legacy);
      }
    }
    await database.prepare("INSERT INTO settings(key,value) VALUES('downloads_profile_settings_migrated','1') ON CONFLICT(key) DO UPDATE SET value='1'").run();
  });
  await tx();
  await reloadSettingCache();
}

// These preferences originally remained global during the first profile
// migration. Copy their legacy values into every existing profile once; an
// explicit profile value always wins. The old global rows are intentionally
// left in place so downgrading across this transition remains non-destructive.
const DOWNLOADS_PROFILE_V2_KEYS = [
  "write_auto_subs", "sub_langs", "retention_days", "delete_watched",
  "delete_watched_hours", "keep_liked",
] as const;
if (getSetting("downloads_profile_preferences_v2_migrated") !== "1") {
  const users = await database.prepare("SELECT id FROM users").all() as { id: number }[];
  const tx = database.transaction(async () => {
    for (const user of users) {
      for (const key of DOWNLOADS_PROFILE_V2_KEYS) {
        const legacy = getSetting(`plugin_downloads_${key}`);
        if (legacy == null) continue;
        await database.prepare("INSERT OR IGNORE INTO plugin_settings (plugin_id, user_id, key, value) VALUES ('downloads', ?, ?, ?)")
          .run(user.id, key, legacy);
      }
    }
    await database.prepare("INSERT INTO settings(key,value) VALUES('downloads_profile_preferences_v2_migrated','1') ON CONFLICT(key) DO UPDATE SET value='1'").run();
  });
  await tx();
  await reloadSettingCache();
}

function normalizePluginLanguage(language: string | null | undefined): PluginLanguage {
  return language === "pl" || language === "de" || language === "en" ? language : "en";
}

function text(value: LocalizedText, language: string | null | undefined) {
  return value[normalizePluginLanguage(language)] ?? value.en;
}

function localizeSetting(def: PluginSettingSource, language: string | null | undefined): PluginSettingDef {
  return {
    ...def,
    type: def.type ?? "slider",
    label: text(def.label, language),
    description: text(def.description, language),
    options: def.options?.map((option) => ({ value: option.value, label: text(option.label, language) })),
  };
}

function localizePlugin(manifest: PluginManifest, language: string | null | undefined): PluginManifest {
  const copy = PLUGIN_TEXT[manifest.id];
  if (!copy) return manifest;
  return {
    ...manifest,
    name: text(copy.name, language),
    description: text(copy.description, language),
    permissions: manifest.permissions.map((permission) => text(copy.permissions[permission] ?? { en: permission, pl: permission, de: permission }, language)),
  };
}

export async function listPlugins(language?: string | null) {
  const states = await database.prepare("SELECT id, enabled, version FROM plugins").all() as { id: string; enabled: number; version: string }[];
  const byId = new Map(states.map((s) => [s.id, s]));
  return PLUGINS.filter((manifest) => manifest.id !== "downloads").map((manifest) => {
    const state = byId.get(manifest.id);
    return { ...localizePlugin(manifest, language), enabled: state?.enabled !== 0 };
  });
}

const pluginEnabledCache = new Map(
  (await database.prepare("SELECT id, enabled FROM plugins").all() as { id: string; enabled: number }[])
    .map((row) => [row.id, row.enabled !== 0]),
);

export function pluginEnabled(id: string) {
  return pluginEnabledCache.get(id) ?? true;
}

export async function setPluginEnabled(id: string, enabled: boolean) {
  const manifest = PLUGINS.find((p) => p.id === id);
  if (!manifest) throw new Error("plugin not found");
  await database.prepare(
    "INSERT INTO plugins (id, enabled, version, updated_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled, version = excluded.version, updated_at = excluded.updated_at"
  ).run(id, enabled ? 1 : 0, manifest.version);
  pluginEnabledCache.set(id, enabled);
}

function settingDefs(pluginId: string): PluginSettingSource[] {
  if (pluginId === "discovery") return DISCOVERY_SETTINGS;
  if (pluginId === "downloads") return DOWNLOADS_SETTINGS;
  if (pluginId === "social") return SOCIAL_SETTINGS;
  return [];
}

function settingScope(pluginId: string, manifest: PluginManifest, def: PluginSettingSource): "user" | "global" {
  if (pluginId === "downloads" && DOWNLOADS_ADMIN_SETTING_KEYS.has(def.key)) return "global";
  return def.scope ?? manifest.settingsScope ?? "user";
}

export function pluginAdminSettingKeys(pluginId: string): Set<string> {
  return new Set(settingDefs(pluginId).filter((def) => def.adminOnly || (pluginId === "downloads" && DOWNLOADS_ADMIN_SETTING_KEYS.has(def.key))).map((def) => def.key));
}

// Coerce a stored/incoming raw value to something valid for the definition;
// anything unparseable falls back to the default.
function normalizeSettingValue(raw: string | null | undefined, def: PluginSettingSource): PluginSettingValue {
  const type = def.type ?? "slider";
  if (type === "select") {
    return def.options?.some((option) => option.value === raw) ? (raw as string) : (def.defaultValue as string);
  }
  if (type === "text") {
    const value = typeof raw === "string" ? raw.trim() : "";
    return value || (def.defaultValue as string);
  }
  if (type === "multiselect") {
    // Stored as a comma-separated list of option values (yt-dlp friendly).
    const valid = new Set((def.options ?? []).map((option) => option.value));
    const picked = typeof raw === "string"
      ? [...new Set(raw.split(",").map((item) => item.trim()).filter((item) => valid.has(item)))]
      : [];
    return picked.length > 0 ? picked.join(",") : (def.defaultValue as string);
  }
  const n = Number(raw);
  const value = raw != null && Number.isFinite(n) ? n : Number(def.defaultValue);
  if (type === "toggle") return value === 1 ? 1 : 0;
  return clampSetting(value, def);
}

export async function getPluginSettings(uid: number, pluginId: string, language?: string | null) {
  const manifest = PLUGINS.find((p) => p.id === pluginId);
  if (!manifest) throw new Error("plugin not found");
  const defs = settingDefs(pluginId);
  const values = new Map<string, string>();
  const rows = await database.prepare("SELECT key, value FROM plugin_settings WHERE plugin_id = ? AND user_id = ?")
    .all(pluginId, uid) as { key: string; value: string }[];
  for (const row of rows) values.set(row.key, row.value);
  for (const def of defs) {
    if (settingScope(pluginId, manifest, def) !== "global") continue;
    const raw = getSetting(`plugin_${pluginId}_${def.key}`);
    if (raw != null) values.set(def.key, raw);
  }
  const settings: Record<string, PluginSettingValue> = {};
  for (const def of defs) {
    settings[def.key] = normalizeSettingValue(values.get(def.key), def);
  }
  return {
    definitions: defs.map((def) => localizeSetting(def, language)),
    settings,
    terms: pluginId === "discovery" ? await discoveryTermState(uid) : undefined,
  };
}

export async function setPluginSettings(uid: number, pluginId: string, patch: Record<string, unknown>, language?: string | null) {
  const manifest = PLUGINS.find((p) => p.id === pluginId);
  if (!manifest) throw new Error("plugin not found");
  const defs = settingDefs(pluginId);
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const tx = database.transaction(async () => {
    for (const [key, value] of Object.entries(patch)) {
      const def = byKey.get(key);
      if (!def) continue;
      const normalized = normalizeSettingValue(value == null ? null : String(value), def);
      if (settingScope(pluginId, manifest, def) === "global") {
        await database.prepare(
          "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
        ).run(`plugin_${pluginId}_${key}`, String(normalized));
      } else {
        await database.prepare(
          "INSERT INTO plugin_settings (plugin_id, user_id, key, value) VALUES (?, ?, ?, ?) ON CONFLICT(plugin_id, user_id, key) DO UPDATE SET value = excluded.value"
        ).run(pluginId, uid, key, String(normalized));
      }
    }
  });
  await tx();
  // Global plugin values are read through db.ts' synchronous settings cache.
  // Keep it aligned with the transaction before building the response; without
  // this, the UI receives the previous values and appears to undo the change.
  if (Object.keys(patch).some((key) => {
    const def = byKey.get(key);
    return def ? settingScope(pluginId, manifest, def) === "global" : false;
  })) await reloadSettingCache();
  if (pluginId === "discovery" && "blockedTerms" in patch) {
    await setDiscoveryBlockedTerms(uid, patch.blockedTerms);
  }
  if (pluginId === "discovery") {
    await invalidateDiscoveryRecommendations(uid);
    refreshDiscoveryInBackground(uid);
  }
  return getPluginSettings(uid, pluginId, language);
}

// Portable backup is adapter-driven: core never serializes plugin tables or
// opaque state. Each adapter exposes only values owned and validated by the
// current plugin implementation.
export interface PortablePluginBackupAdapter {
  id: string;
  scope: "instance" | "profile";
  schemaVersion: number;
  export(userId: number): Promise<unknown>;
  restore(userId: number, value: unknown): Promise<void>;
}

export const PLUGIN_BACKUP_ADAPTERS: readonly PortablePluginBackupAdapter[] = [
  {
    id: "social",
    scope: "instance",
    schemaVersion: 2,
    async export(userId) {
      const settings = (await getPluginSettings(userId, "social")).settings;
      return { settings: Object.fromEntries(Object.entries(settings).filter(([key]) => ["comments_enabled", "reactions_enabled", "allow_child_profiles"].includes(key))) };
    },
    async restore(userId, value) {
      const input = value && typeof value === "object" ? value as any : {};
      const settings = Object.fromEntries(Object.entries(input.settings ?? {}).filter(([key]) => ["comments_enabled", "reactions_enabled", "allow_child_profiles"].includes(key)));
      await setPluginSettings(userId, "social", settings);
    },
  },
  {
    id: "social",
    scope: "profile",
    schemaVersion: 3,
    async export(userId) {
      const settings = (await getPluginSettings(userId, "social")).settings;
      const recentEmojis = (await database.prepare("SELECT reaction_key FROM social_recent_emojis WHERE user_id=? ORDER BY used_at DESC,reaction_key LIMIT 6")
        .all(userId) as Array<{ reaction_key: string }>).map((row) => row.reaction_key);
      const skinToneRow = await database.prepare("SELECT value FROM plugin_state WHERE plugin_id='social' AND user_id=? AND key='emoji_skin_tone'")
        .get(userId) as { value: string } | null;
      let skinTone = "neutral";
      try { skinTone = normalizeSocialEmojiSkinTone(skinToneRow?.value); } catch {}
      return { settings: Object.fromEntries(Object.entries(settings).filter(([key]) => ["notify_new_posts", "notify_comments", "notify_reactions", "notify_mentions"].includes(key))), recentEmojis, skinTone };
    },
    async restore(userId, value) {
      const input = value && typeof value === "object" ? value as any : {};
      const settings = Object.fromEntries(Object.entries(input.settings ?? {}).filter(([key]) => ["notify_new_posts", "notify_comments", "notify_reactions", "notify_mentions"].includes(key)));
      await setPluginSettings(userId, "social", settings);
      if (Array.isArray(input.recentEmojis)) {
        const recentEmojis = [...new Set(input.recentEmojis.flatMap((value: unknown) => {
          try { return [normalizeSocialReaction(value)]; } catch { return []; }
        }))].slice(0, 6);
        await database.transaction(async () => {
          await database.prepare("DELETE FROM social_recent_emojis WHERE user_id=?").run(userId);
          const now = Date.now();
          for (const [index, emoji] of recentEmojis.entries()) {
            await database.prepare("INSERT INTO social_recent_emojis(user_id,reaction_key,used_at) VALUES(?,?,?)").run(userId, emoji, now - index);
          }
        })();
      }
      if (Object.hasOwn(input, "skinTone")) {
        let skinTone: string | null = null;
        try { skinTone = normalizeSocialEmojiSkinTone(input.skinTone); } catch {}
        if (skinTone) await database.prepare(`
          INSERT INTO plugin_state(plugin_id,user_id,key,value,updated_at) VALUES('social',?,'emoji_skin_tone',?,CURRENT_TIMESTAMP)
          ON CONFLICT(plugin_id,user_id,key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at
        `).run(userId, skinTone);
      }
    },
  },
  {
    id: "discovery",
    scope: "profile",
    schemaVersion: 1,
    async export(userId) {
      const blocked = await database.prepare("SELECT value FROM plugin_state WHERE plugin_id='discovery' AND user_id=? AND key='blocked_terms'").get(userId) as { value: string } | null;
      let blockedTerms: string[] = [];
      try { blockedTerms = blocked ? JSON.parse(blocked.value) : []; } catch {}
      return { settings: (await getPluginSettings(userId, "discovery")).settings, blockedTerms };
    },
    async restore(userId, value) {
      const input = value && typeof value === "object" ? value as any : {};
      await setPluginSettings(userId, "discovery", { ...(input.settings ?? {}), blockedTerms: Array.isArray(input.blockedTerms) ? input.blockedTerms : [] });
    },
  },
  {
    id: "downloads",
    scope: "profile",
    schemaVersion: 3,
    async export(userId) {
      const rules = await listDownloadRules(userId);
      const playlistIds = [...new Set(rules.flatMap((rule) => rule.playlist_ids))];
      const playlists = playlistIds.length
        ? await database.prepare(`SELECT playlist_id, channel_id, title, thumbnail, video_count FROM channel_playlists WHERE playlist_id IN (${playlistIds.map(() => "?").join(",")})`).all(...playlistIds)
        : [];
      const allSettings = (await getPluginSettings(userId, "downloads")).settings;
      const settings = Object.fromEntries(Object.entries(allSettings).filter(([key]) => !DOWNLOADS_ADMIN_SETTING_KEYS.has(key)));
      return { settings, rules, playlists };
    },
    async restore(userId, value) {
      const input = value && typeof value === "object" ? value as any : {};
      await setPluginSettings(userId, "downloads", input.settings ?? {});
      for (const playlist of Array.isArray(input.playlists) ? input.playlists : []) {
        if (!playlist?.playlist_id || !playlist?.channel_id) continue;
        await database.prepare("INSERT INTO channels(channel_id,title,url,external) VALUES(?,?,?,1) ON CONFLICT(channel_id) DO NOTHING").run(playlist.channel_id, "", "");
        await database.prepare("INSERT INTO channel_playlists(playlist_id,channel_id,title,thumbnail,video_count) VALUES(?,?,?,?,?) ON CONFLICT(playlist_id) DO UPDATE SET title=excluded.title,thumbnail=excluded.thumbnail,video_count=excluded.video_count")
          .run(playlist.playlist_id, playlist.channel_id, String(playlist.title ?? ""), String(playlist.thumbnail ?? ""), String(playlist.video_count ?? ""));
      }
      await restoreDownloadRules(userId, input.rules);
    },
  },
] as const;

export async function resetPluginState(uid: number, pluginId: string, language?: string | null) {
  if (!PLUGINS.some((plugin) => plugin.id === pluginId)) throw new Error("plugin not found");
  if (pluginId === "social") {
    await database.transaction(async () => {
      await database.prepare("DELETE FROM social_posts").run();
      await database.prepare("DELETE FROM social_recent_emojis").run();
      await database.prepare("DELETE FROM plugin_state WHERE plugin_id='social'").run();
      await database.prepare("DELETE FROM plugin_settings WHERE plugin_id='social'").run();
      await database.prepare("DELETE FROM settings WHERE key LIKE 'plugin_social_%'").run();
      await database.prepare("DELETE FROM notifications WHERE kind LIKE 'social_%'").run();
    })();
    await reloadSettingCache();
    return getPluginSettings(uid, pluginId, language);
  }
  if (pluginId === "downloads") {
    await resetDownloadsState(uid);
    await reloadSettingCache();
    return getPluginSettings(uid, pluginId, language);
  }
  if (pluginId === "discovery") {
    const timer = discoveryRefreshTimers.get(uid);
    if (timer) {
      clearTimeout(timer);
      discoveryRefreshTimers.delete(uid);
    }
    await discoveryRefreshInFlight.get(uid)?.catch(() => {});
  }

  const tx = database.transaction(async () => {
    if (pluginId === "discovery") {
      // Remove only temporary videos introduced by this profile's recommendations.
      // Anything watched, queued, liked or saved by any profile remains intact.
      await database.prepare(`
        DELETE FROM videos
        WHERE external = 1
          AND video_id IN (SELECT video_id FROM discovery_recommendations WHERE user_id = ?)
          AND NOT EXISTS (
            SELECT 1 FROM user_videos uv
            WHERE uv.video_id = videos.video_id
              AND (uv.status = 'queued' OR uv.liked = 1 OR uv.watch_position IS NOT NULL)
          )
          AND NOT EXISTS (SELECT 1 FROM user_playlist_videos upv WHERE upv.video_id = videos.video_id)
          AND NOT EXISTS (SELECT 1 FROM history h WHERE h.video_id = videos.video_id)
          AND NOT EXISTS (SELECT 1 FROM social_posts sp WHERE sp.video_id = videos.video_id)
      `).run(uid);
      await database.prepare("DELETE FROM discovery_recommendations WHERE user_id = ?").run(uid);
      await database.prepare("DELETE FROM recommendation_feedback WHERE user_id = ?").run(uid);
      await database.prepare("DELETE FROM channels WHERE external = 1 AND channel_id NOT IN (SELECT DISTINCT channel_id FROM videos)").run();
    }
    await database.prepare("DELETE FROM plugin_settings WHERE plugin_id = ? AND user_id = ?").run(pluginId, uid);
    await database.prepare("DELETE FROM plugin_state WHERE plugin_id = ? AND user_id = ?").run(pluginId, uid);
  });
  await tx();
  return getPluginSettings(uid, pluginId, language);
}

async function discoverySettings(uid: number): Promise<Record<string, number>> {
  // Discovery definitions are all sliders, so the values are numbers.
  return (await getPluginSettings(uid, "discovery")).settings as Record<string, number>;
}

async function discoveryTermState(uid: number): Promise<PluginTermState> {
  return {
    lastTerms: await readDiscoveryTerms(uid, "last_terms"),
    blockedTerms: await readDiscoveryTerms(uid, "blocked_terms"),
  };
}

async function readDiscoveryTerms(uid: number, key: "last_terms" | "blocked_terms") {
  const row = await database.prepare("SELECT value FROM plugin_state WHERE plugin_id = 'discovery' AND user_id = ? AND key = ?")
    .get(uid, key) as { value: string } | null;
  if (!row) return [];
  try {
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed) ? parsed.filter((term) => typeof term === "string") : [];
  } catch {
    return [];
  }
}

async function writeDiscoveryTerms(uid: number, key: "last_terms" | "blocked_terms", terms: string[]) {
  await database.prepare(`
    INSERT INTO plugin_state (plugin_id, user_id, key, value, updated_at)
    VALUES ('discovery', ?, ?, ?, datetime('now'))
    ON CONFLICT(plugin_id, user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(uid, key, JSON.stringify(terms));
}

async function setDiscoveryBlockedTerms(uid: number, value: unknown) {
  const raw = Array.isArray(value) ? value : [];
  const normalized = Array.from(new Set(raw.flatMap((term) => typeof term === "string" ? tokenizeDiscoveryText(term) : []))).sort();
  await writeDiscoveryTerms(uid, "blocked_terms", normalized);
}

function clampSetting(value: number, def: Pick<PluginSettingDef, "min" | "max" | "step">) {
  const step = def.step ?? 1;
  const stepped = Math.round(value / step) * step;
  return Math.min(def.max ?? Infinity, Math.max(def.min ?? -Infinity, stepped));
}

export interface DiscoveryRecommendation {
  kind: "local" | "external";
  score: number;
  reasons: string[];
  video?: any;
  result?: SearchResult;
  query?: string;
}

const DISCOVERY_REFRESH_INTERVAL_MS = 15 * 60 * 1000;
const discoveryRefreshInFlight = new Map<number, Promise<void>>();
const discoveryRefreshTimers = new Map<number, ReturnType<typeof setTimeout>>();

async function localRecommendations(
  uid: number,
  limit: number,
  settings: Record<string, number>,
  options: { allowExternal?: boolean; downloadsOnly?: boolean } = {},
): Promise<DiscoveryRecommendation[]> {
  const local = zonedDayHour();
  const nearbyHours = recommendationHoursNear(local.hour).join(",");
  // Candidate ownership is intentionally profile-scoped. Videos are global in
  // storage, so a plain scan would leak another profile's library and habits.
  const profileOwnsCandidate = `(
    (${followedExists(uid)} OR ${followedPlaylistExists(uid)})
    OR EXISTS (SELECT 1 FROM user_videos own_uv WHERE own_uv.user_id = ${uid} AND own_uv.video_id = v.video_id)
    OR EXISTS (SELECT 1 FROM history own_h WHERE own_h.user_id = ${uid} AND own_h.video_id = v.video_id)
    OR EXISTS (
      SELECT 1 FROM user_playlist_videos own_upv
      JOIN user_playlists own_up ON own_up.id = own_upv.playlist_id AND own_up.user_id = ${uid}
      WHERE own_upv.video_id = v.video_id
    )
    OR EXISTS (SELECT 1 FROM discovery_recommendations own_dr WHERE own_dr.user_id = ${uid} AND own_dr.video_id = v.video_id)
  )`;
  const externalWhere = options.allowExternal === false ? "AND v.external = 0" : "";
  const downloadsWhere = options.downloadsOnly
    ? `AND EXISTS (SELECT 1 FROM downloads allowed_download JOIN download_owners allowed_owner ON allowed_owner.video_id=allowed_download.video_id WHERE allowed_owner.user_id=${uid} AND allowed_download.video_id = v.video_id AND allowed_download.status = 'done')`
    : "";

  const rows = await database.prepare(`${effectiveVideoTagsCte}
    SELECT v.video_id, v.channel_id, v.title, v.description, v.thumbnail, v.published_at,
           v.live_status, COALESCE(uv.status, 'inbox') AS status, uv.bucket, uv.show_from,
           v.is_short, v.is_private, v.views, v.likes, uv.liked, uv.watched,
           v.duration, uv.watch_position, uv.watch_duration, v.external,
           EXISTS(SELECT 1 FROM history h WHERE h.video_id = v.video_id AND h.user_id = ${uid}) AS in_history,
           COALESCE(c.custom_title, c.title) AS channel_title, c.thumbnail AS channel_thumbnail, c.subscriber_count AS channel_subscriber_count,
           COALESCE(chw.watch_count, 0) AS channel_watch_count,
           COALESCE(chtime.watch_seconds, 0) AS channel_watch_seconds,
           COALESCE(chtime.time_seconds, 0) AS channel_time_seconds,
           COALESCE(taghit.tag_hits, 0) AS tag_hits,
           COALESCE(tagwatch.tag_watch_count, 0) AS tag_watch_count,
           COALESCE(tagtime.time_seconds, 0) AS tag_time_seconds,
           COALESCE(plhit.playlist_hits, 0) AS playlist_hits
    FROM videos v
    JOIN channels c ON c.channel_id = v.channel_id
    LEFT JOIN user_videos uv ON uv.video_id = v.video_id AND uv.user_id = ${uid}
    LEFT JOIN (
      SELECT v2.channel_id, count(DISTINCT h.video_id) AS watch_count
      FROM history h JOIN videos v2 ON v2.video_id = h.video_id
      WHERE h.user_id = ${uid}
      GROUP BY v2.channel_id
    ) chw ON chw.channel_id = v.channel_id
    LEFT JOIN (
      SELECT v2.channel_id, SUM(w.seconds) AS watch_seconds,
             SUM(CASE WHEN w.hour IN (${nearbyHours}) THEN w.seconds ELSE 0 END) AS time_seconds
      FROM watch_time_log w JOIN videos v2 ON v2.video_id = w.video_id
      WHERE w.user_id = ${uid}
      GROUP BY v2.channel_id
    ) chtime ON chtime.channel_id = v.channel_id
    LEFT JOIN (
      SELECT candidate.video_id, count(DISTINCT candidate.tag_id) AS tag_hits
      FROM effective_video_tags candidate
      JOIN (
        SELECT DISTINCT source.tag_id
        FROM effective_video_tags source
        LEFT JOIN user_videos suv ON suv.video_id = source.video_id AND suv.user_id = ${uid}
        WHERE source.user_id = ${uid}
          AND (suv.liked = 1 OR EXISTS (
            SELECT 1 FROM history h2 WHERE h2.video_id = source.video_id AND h2.user_id = ${uid}
          ))
      ) liked_tags ON liked_tags.tag_id = candidate.tag_id
      WHERE candidate.user_id = ${uid}
      GROUP BY candidate.video_id
    ) taghit ON taghit.video_id = v.video_id
    LEFT JOIN (
      SELECT upv.video_id, count(*) AS playlist_hits
      FROM user_playlist_videos upv JOIN user_playlists up ON up.id = upv.playlist_id
      WHERE up.user_id = ${uid}
      GROUP BY upv.video_id
    ) plhit ON plhit.video_id = v.video_id
    LEFT JOIN (
      SELECT candidate.video_id, sum(watched_tags.watch_count) AS tag_watch_count
      FROM effective_video_tags candidate
      JOIN (
        SELECT source.tag_id, count(DISTINCT source.video_id) AS watch_count
        FROM effective_video_tags source
        JOIN history h4 ON h4.video_id = source.video_id AND h4.user_id = ${uid}
        WHERE source.user_id = ${uid}
        GROUP BY source.tag_id
      ) watched_tags ON watched_tags.tag_id = candidate.tag_id
      WHERE candidate.user_id = ${uid}
      GROUP BY candidate.video_id
    ) tagwatch ON tagwatch.video_id = v.video_id
    LEFT JOIN (
      SELECT candidate.video_id, SUM(tag_clock.seconds) AS time_seconds
      FROM effective_video_tags candidate
      JOIN (
        SELECT tag_id, SUM(seconds) AS seconds
        FROM watch_tag_time_log
        WHERE user_id = ${uid} AND hour IN (${nearbyHours})
        GROUP BY tag_id
      ) tag_clock ON tag_clock.tag_id = candidate.tag_id
      WHERE candidate.user_id = ${uid}
      GROUP BY candidate.video_id
    ) tagtime ON tagtime.video_id = v.video_id
    WHERE v.is_short = 0
      AND v.live_status = 'none'
      AND COALESCE(v.is_private, 0) = 0
      AND v.published_at IS NOT NULL AND v.published_at != ''
      AND TRIM(v.title) != '' AND TRIM(v.thumbnail) != ''
      AND TRIM(COALESCE(c.custom_title, c.title)) != ''
      AND COALESCE(uv.status, 'inbox') = 'inbox'
      AND COALESCE(uv.watched, 0) != 1
      AND (uv.watch_position IS NULL OR uv.watch_duration IS NULL OR uv.watch_duration <= 30
        OR uv.watch_position < 3 OR CAST(uv.watch_position AS REAL) / uv.watch_duration < 0.92)
      AND ${profileOwnsCandidate}
      ${externalWhere}
      ${downloadsWhere}
      AND NOT EXISTS (
        SELECT 1 FROM recommendation_feedback rf
        WHERE rf.user_id = ${uid} AND rf.video_id = v.video_id AND rf.action = 'dismiss'
      )
    ORDER BY v.published_at DESC, v.video_id DESC
    LIMIT 300
  `).all() as any[];

  return rows
    .map((video) => scoreRecommendationCandidate(video, settings))
    .filter((recommendation): recommendation is DiscoveryRecommendation => recommendation != null)
    .sort((a, b) => b.score - a.score || String(a.video?.video_id).localeCompare(String(b.video?.video_id)))
    .slice(0, Math.max(0, Math.floor(limit)));
}

async function externalRecommendations(uid: number, limit: number, settings: Record<string, number>): Promise<DiscoveryRecommendation[]> {
  const seedRows = await database.prepare(`
    SELECT v.title AS text,
           CASE WHEN uv.liked = 1 THEN 6
                WHEN EXISTS (SELECT 1 FROM history h WHERE h.video_id = v.video_id AND h.user_id = ?) THEN 3
                ELSE 2 END AS weight,
           'title' AS kind
    FROM videos v
    LEFT JOIN user_videos uv ON uv.video_id = v.video_id AND uv.user_id = ?
    WHERE uv.liked = 1
       OR EXISTS (SELECT 1 FROM history h WHERE h.video_id = v.video_id AND h.user_id = ?)
       OR uv.watch_position IS NOT NULL
    ORDER BY COALESCE(
      (SELECT MAX(h.watched_at) FROM history h WHERE h.video_id = v.video_id AND h.user_id = ?),
      v.published_at,
      v.created_at
    ) DESC
    LIMIT 80
  `).all(uid, uid, uid, uid) as KeywordSeed[];
  const tagRows = await database.prepare(`
    SELECT t.name AS text, 5 AS weight, 'tag' AS kind
    FROM tags t
    WHERE t.user_id = ? AND (
      EXISTS (SELECT 1 FROM video_tags vt JOIN user_videos uv ON uv.video_id = vt.video_id AND uv.user_id = ? WHERE vt.tag_id = t.id AND uv.liked = 1)
      OR EXISTS (SELECT 1 FROM channel_tags ct JOIN videos v ON v.channel_id = ct.channel_id JOIN history h ON h.video_id = v.video_id AND h.user_id = ? WHERE ct.tag_id = t.id)
    )
  `).all(uid, uid, uid) as KeywordSeed[];
  const blockedTerms = new Set(await readDiscoveryTerms(uid, "blocked_terms"));
  const keywordPlan = buildKeywordPlan([...tagRows, ...seedRows], blockedTerms, 24, 3);
  const foundTerms = keywordPlan.terms;
  await writeDiscoveryTerms(uid, "last_terms", foundTerms);
  const queries = keywordPlan.queries;

  const candidates: (SearchResult & { query: string; matchScore: number })[] = [];
  const seen = new Set<string>();
  for (const query of queries) {
    const queryTerms = new Set(tokenizeDiscoveryText(query));
    const search = await searchYouTube(query).catch(() => ({ results: [], channels: [] }));
    for (const result of search.results) {
      if (seen.has(result.videoId)) continue;
      if (await database.prepare("SELECT 1 FROM recommendation_feedback WHERE user_id = ? AND video_id = ? AND action = 'dismiss'").get(uid, result.videoId)) continue;
      seen.add(result.videoId);
      const matchScore = scoreSearchResult(result, queryTerms, settings);
      if (matchScore <= 0) continue;
      candidates.push({ ...result, query, matchScore });
    }
  }

  const imported: DiscoveryRecommendation[] = [];
  for (const candidate of candidates.sort((a, b) => b.matchScore - a.matchScore).slice(0, limit * 2)) {
    const info = await fetchVideoInfo(candidate.videoId).catch(() => null);
    if (!info) continue;
    if (info.liveStatus !== "none") continue;
    // A network error is `null`, not proof that this is a regular video.
    if (await classifyIsShort(info.videoId, info.title) !== false) continue;
    const about = await fetchChannelAbout(info.channelId).catch(() => null);
    await upsertExternalVideo(info, about?.avatar ?? "");
    const video = await selectVideo(uid, info.videoId);
    if (!video) continue;
    imported.push({
      kind: "local",
      score: settings.outside_base_points + candidate.matchScore,
      reasons: ["external search"],
      query: candidate.query,
      video,
    });
    if (imported.length >= limit) break;
  }
  return imported;
}

function scoreSearchResult(result: SearchResult, terms: Set<string>, settings: Record<string, number>) {
  const titleTokens = tokenizeDiscoveryText(`${result.title} ${result.channelTitle}`);
  let score = 0;
  for (const token of titleTokens) {
    if (terms.has(token)) score += settings.outside_exact_match_points;
    else {
      for (const term of terms) {
        if (token.includes(term) || term.includes(token)) {
          score += settings.outside_partial_match_points;
          break;
        }
      }
    }
  }
  if (result.viewCount != null && result.viewCount > 1000) score += 3;
  return score;
}

async function upsertExternalVideo(info: VideoInfo, channelThumbnail: string) {
  await database.prepare(`
    INSERT INTO channels (channel_id, title, url, thumbnail, followed, external)
    VALUES (?, ?, ?, ?, 0, 1)
    ON CONFLICT(channel_id) DO UPDATE SET
      title = CASE WHEN channels.title = '' OR channels.title IS NULL THEN excluded.title ELSE channels.title END,
      thumbnail = CASE WHEN channels.thumbnail = '' OR channels.thumbnail IS NULL THEN excluded.thumbnail ELSE channels.thumbnail END
  `).run(info.channelId, info.channelTitle, `https://www.youtube.com/channel/${info.channelId}`, channelThumbnail);

  await database.prepare(`
    INSERT INTO videos
      (video_id, channel_id, title, description, thumbnail, published_at, live_status, status, views, duration, is_short, external)
    VALUES (?, ?, ?, ?, ?, ?, 'none', 'inbox', ?, ?, 0, 1)
    ON CONFLICT(video_id) DO UPDATE SET
      title = CASE WHEN videos.title = '' OR videos.title IS NULL THEN excluded.title ELSE videos.title END,
      description = CASE WHEN videos.description = '' OR videos.description IS NULL THEN excluded.description ELSE videos.description END,
      thumbnail = CASE WHEN videos.thumbnail = '' OR videos.thumbnail IS NULL THEN excluded.thumbnail ELSE videos.thumbnail END,
      views = COALESCE(videos.views, excluded.views),
      duration = COALESCE(videos.duration, excluded.duration),
      live_status = CASE
        WHEN videos.live_status IN ('live', 'upcoming', 'was_live') THEN videos.live_status
        ELSE excluded.live_status
      END,
      is_short = CASE WHEN videos.is_short = 1 THEN 1 ELSE COALESCE(videos.is_short, excluded.is_short) END
  `).run(
    info.videoId,
    info.channelId,
    info.title,
    info.description,
    info.thumbnail,
    info.publishedAt,
    info.viewCount,
    info.duration,
  );
}

async function selectVideo(uid: number, videoId: string) {
  return await database.prepare(`
    SELECT v.video_id, v.channel_id, v.title, v.description, v.thumbnail,
           v.published_at, v.live_status, COALESCE(uv.status, 'inbox') AS status, uv.bucket, uv.show_from,
           v.is_short, v.is_private, v.views, v.likes, uv.liked, uv.watched,
           v.duration, uv.watch_position, uv.watch_duration, v.external,
           EXISTS(SELECT 1 FROM history h WHERE h.video_id = v.video_id AND h.user_id = ?) AS in_history,
           COALESCE(c.custom_title, c.title) AS channel_title, c.thumbnail AS channel_thumbnail, c.subscriber_count AS channel_subscriber_count
    FROM videos v JOIN channels c ON c.channel_id = v.channel_id
    LEFT JOIN user_videos uv ON uv.video_id = v.video_id AND uv.user_id = ?
    WHERE v.video_id = ?
  `).get(uid, uid, videoId) as any | null;
}

export async function discoveryRecommendations(_uid: number): Promise<{ recommendations: DiscoveryRecommendation[]; enabled: boolean }> {
  return { recommendations: [], enabled: pluginEnabled("discovery") };
}

export async function refreshDiscoveryNow(_uid: number): Promise<{ recommendations: DiscoveryRecommendation[]; enabled: boolean }> {
  return { recommendations: [], enabled: pluginEnabled("discovery") };
}

// Recommendations are a read-only projection. Library mutations must never
// schedule searches, imports or recommendation-state writes.
export function refreshDiscoveryInBackground(_uid: number) {}

async function runDiscoveryRefresh(uid: number) {
  if (maintenanceActive()) return;
  const current = discoveryRefreshInFlight.get(uid);
  if (current) return current;
  const promise = rebuildDiscoveryRecommendations(uid).finally(() => discoveryRefreshInFlight.delete(uid));
  discoveryRefreshInFlight.set(uid, promise);
  return promise;
}

async function rebuildDiscoveryRecommendations(uid: number) {
  if (!pluginEnabled("discovery")) return;
  const startedAt = Date.now();
  const settings = await discoverySettings(uid);
  const totalLimit = settings.total_limit;
  const local = await localRecommendations(uid, Math.max(24, totalLimit), settings);
  const importedExternal = await externalRecommendations(uid, Math.max(settings.early_external_count, 8), settings);
  const recommendations = mixRecommendations([...local, ...importedExternal], totalLimit, settings);
  await persistDiscoveryRecommendations(uid, recommendations);
  log.info("discovery.refresh_complete", {
    userId: uid,
    localCandidates: local.length,
    externalCandidates: importedExternal.length,
    recommendations: recommendations.length,
    ms: Date.now() - startedAt,
  });
}

async function persistDiscoveryRecommendations(uid: number, recommendations: DiscoveryRecommendation[]) {
  const tx = database.transaction(async () => {
    await database.prepare("DELETE FROM discovery_recommendations WHERE user_id = ?").run(uid);
    const insert = database.prepare(`
      INSERT INTO discovery_recommendations (user_id, video_id, score, reasons_json, query, rank, generated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `);
    for (const [index, recommendation] of recommendations.entries()) {
      const videoId = recommendation.video?.video_id;
      if (!videoId) continue;
      await insert.run(
        uid,
        videoId,
        recommendation.score,
        JSON.stringify(recommendation.reasons),
        recommendation.query ?? null,
        index,
      );
    }
    await setDiscoveryGeneratedAt(uid);
  });
  await tx();
}

async function invalidateDiscoveryRecommendations(uid: number) {
  const timer = discoveryRefreshTimers.get(uid);
  if (timer) {
    clearTimeout(timer);
    discoveryRefreshTimers.delete(uid);
  }
  await database.prepare("DELETE FROM discovery_recommendations WHERE user_id = ?").run(uid);
  await database.prepare("DELETE FROM plugin_state WHERE plugin_id = 'discovery' AND user_id = ? AND key = 'last_generated_at'").run(uid);
}

async function setDiscoveryGeneratedAt(uid: number) {
  await database.prepare(`
    INSERT INTO plugin_state (plugin_id, user_id, key, value, updated_at)
    VALUES ('discovery', ?, 'last_generated_at', datetime('now'), datetime('now'))
    ON CONFLICT(plugin_id, user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(uid);
}

async function readStoredDiscoveryRecommendations(uid: number, limit: number): Promise<DiscoveryRecommendation[]> {
  const rows = await database.prepare(`
    SELECT dr.video_id, dr.score, dr.reasons_json, dr.query
    FROM discovery_recommendations dr
    JOIN videos v ON v.video_id = dr.video_id
    JOIN channels c ON c.channel_id = v.channel_id
    LEFT JOIN user_videos uv ON uv.user_id = dr.user_id AND uv.video_id = dr.video_id
    WHERE dr.user_id = ?
      AND v.is_short = 0
      AND v.live_status = 'none'
      AND COALESCE(v.is_private, 0) = 0
      AND v.published_at IS NOT NULL AND v.published_at != ''
      AND TRIM(v.title) != '' AND TRIM(v.thumbnail) != ''
      AND TRIM(COALESCE(c.custom_title, c.title)) != ''
      AND COALESCE(uv.status, 'inbox') = 'inbox'
      AND COALESCE(uv.watched, 0) != 1
      AND (uv.watch_position IS NULL OR uv.watch_duration IS NULL OR uv.watch_duration <= 30
        OR uv.watch_position < 3 OR CAST(uv.watch_position AS REAL) / uv.watch_duration < 0.92)
      AND NOT EXISTS (
        SELECT 1 FROM recommendation_feedback rf
        WHERE rf.user_id = dr.user_id
          AND rf.video_id = dr.video_id
          AND rf.action = 'dismiss'
      )
    ORDER BY dr.rank ASC
    LIMIT ?
  `).all(uid, limit) as { video_id: string; score: number; reasons_json: string; query: string | null }[];
  const out: DiscoveryRecommendation[] = [];
  for (const row of rows) {
    const video = await selectVideo(uid, row.video_id);
    if (!video || !isEligibleRecommendation(video)) continue;
    out.push({
      kind: "local",
      score: Number(row.score),
      reasons: parseReasons(row.reasons_json),
      query: row.query ?? undefined,
      video,
    });
  }
  return out;
}

function parseReasons(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((reason) => typeof reason === "string") : [];
  } catch {
    return [];
  }
}

async function storedDiscoveryAgeMs(uid: number) {
  const state = await database.prepare("SELECT value AS generated_at FROM plugin_state WHERE plugin_id = 'discovery' AND user_id = ? AND key = 'last_generated_at'")
    .get(uid) as { generated_at: string | null } | null;
  const row = state?.generated_at
    ? state
    : await database.prepare("SELECT MAX(generated_at) AS generated_at FROM discovery_recommendations WHERE user_id = ?")
      .get(uid) as { generated_at: string | null } | null;
  if (!row?.generated_at) return DISCOVERY_REFRESH_INTERVAL_MS;
  const ts = storedUtcTimestampMs(row.generated_at);
  if (!Number.isFinite(ts)) return DISCOVERY_REFRESH_INTERVAL_MS;
  return Math.max(0, Date.now() - ts);
}

export interface RecommendationSummary {
  top_channels: { channel_id: string; title: string; count: number; seconds: number }[];
  top_tags: { id: number; name: string; color: string; count: number; seconds: number }[];
  time_of_day: RecommendationTimeOfDay | null;
  current_hour: number | null;
  watch_count: number;
  partial_count: number;
  based_on: ("watch_history" | "channels" | "tags" | "time_of_day" | "likes" | "unfinished")[];
}

async function recommendationSummary(uid: number): Promise<RecommendationSummary> {
  const local = zonedDayHour();
  const nearbyHours = recommendationHoursNear(local.hour);
  const nearbyHourPlaceholders = nearbyHours.map(() => "?").join(",");
  const stats = await database.prepare(`
    SELECT
      (SELECT COUNT(DISTINCT video_id) FROM history WHERE user_id = ?) AS watch_count,
      (SELECT COUNT(*)
       FROM user_videos partial_uv
       JOIN videos partial_v ON partial_v.video_id = partial_uv.video_id
       WHERE partial_uv.user_id = ? AND COALESCE(partial_uv.watched, 0) != 1
         AND COALESCE(partial_uv.status, 'inbox') != 'archived'
         AND partial_v.is_short = 0 AND partial_v.live_status = 'none'
         AND COALESCE(partial_v.is_private, 0) = 0
         AND partial_uv.watch_position IS NOT NULL AND partial_uv.watch_duration IS NOT NULL
         AND partial_uv.watch_duration > 30 AND partial_uv.watch_position >= 3
         AND CAST(partial_uv.watch_position AS REAL) / partial_uv.watch_duration < 0.92) AS partial_count,
      (SELECT COUNT(*) FROM user_videos WHERE user_id = ? AND liked = 1) AS liked_count
  `).get(uid, uid, uid) as { watch_count: number; partial_count: number; liked_count: number };

  const channelRows = await database.prepare(`
    WITH channel_signals AS (
      SELECT v.channel_id, COUNT(DISTINCT h.video_id) AS watch_count, 0.0 AS seconds
      FROM history h JOIN videos v ON v.video_id = h.video_id
      WHERE h.user_id = ?
      GROUP BY v.channel_id
      UNION ALL
      SELECT v.channel_id, 0 AS watch_count, SUM(w.seconds) AS seconds
      FROM watch_time_log w JOIN videos v ON v.video_id = w.video_id
      WHERE w.user_id = ? AND w.hour IN (${nearbyHourPlaceholders})
      GROUP BY v.channel_id
    )
    SELECT cs.channel_id, COALESCE(c.custom_title, c.title) AS title,
           SUM(cs.watch_count) AS watch_count, SUM(cs.seconds) AS seconds
    FROM channel_signals cs JOIN channels c ON c.channel_id = cs.channel_id
    GROUP BY cs.channel_id, COALESCE(c.custom_title, c.title)
    ORDER BY SUM(cs.seconds) DESC, SUM(cs.watch_count) DESC, cs.channel_id ASC
    LIMIT 3
  `).all(uid, uid, ...nearbyHours) as { channel_id: string; title: string; watch_count: number; seconds: number }[];
  const topChannels = channelRows.map((row) => ({
    channel_id: row.channel_id,
    title: row.title,
    count: Number(row.watch_count) || 0,
    seconds: Math.round(Number(row.seconds) || 0),
  }));

  const tagRows = await database.prepare(`${effectiveVideoTagsCte},
    tag_signals AS (
      SELECT evt.tag_id AS id, evt.name, evt.color,
             COUNT(DISTINCT h.video_id) AS watch_count, 0.0 AS seconds
      FROM effective_video_tags evt
      JOIN history h ON h.video_id = evt.video_id AND h.user_id = ?
      WHERE evt.user_id = ?
      GROUP BY evt.tag_id, evt.name, evt.color
      UNION ALL
      SELECT wt.tag_id AS id, t.name, t.color, 0 AS watch_count, SUM(wt.seconds) AS seconds
      FROM watch_tag_time_log wt
      JOIN tags t ON t.id = wt.tag_id AND t.user_id = wt.user_id
      WHERE wt.user_id = ? AND wt.hour IN (${nearbyHourPlaceholders})
      GROUP BY wt.tag_id, t.name, t.color
    )
    SELECT id, name, color, SUM(watch_count) AS watch_count, SUM(seconds) AS seconds
    FROM tag_signals
    GROUP BY id, name, color
    ORDER BY SUM(seconds) DESC, SUM(watch_count) DESC, id ASC
    LIMIT 3
  `).all(uid, uid, uid, ...nearbyHours) as { id: number; name: string; color: string; watch_count: number; seconds: number }[];
  const topTags = tagRows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    color: row.color,
    count: Number(row.watch_count) || 0,
    seconds: Math.round(Number(row.seconds) || 0),
  }));

  const current = recommendationTimeOfDay(local.hour);
  const clock = await database.prepare(`
    SELECT COALESCE(SUM(seconds), 0) AS seconds
    FROM watch_time_log
    WHERE user_id = ? AND hour IN (${nearbyHourPlaceholders})
  `).get(uid, ...nearbyHours) as { seconds: number };

  const watchCount = Number(stats.watch_count) || 0;
  const partialCount = Number(stats.partial_count) || 0;
  const likedCount = Number(stats.liked_count) || 0;
  const hasCurrentTimeSignal = (Number(clock.seconds) || 0) > 0;
  const basedOn: RecommendationSummary["based_on"] = [];
  if (watchCount > 0) basedOn.push("watch_history");
  if (topChannels.length > 0) basedOn.push("channels");
  if (topTags.length > 0) basedOn.push("tags");
  if (hasCurrentTimeSignal) basedOn.push("time_of_day");
  if (likedCount > 0) basedOn.push("likes");
  if (partialCount > 0) basedOn.push("unfinished");

  return {
    top_channels: topChannels,
    top_tags: topTags,
    time_of_day: hasCurrentTimeSignal ? current : null,
    current_hour: hasCurrentTimeSignal ? local.hour : null,
    watch_count: watchCount,
    partial_count: partialCount,
    based_on: basedOn,
  };
}

export interface RecommendationFeedOptions {
  page?: number;
  limit?: number;
  refresh?: boolean;
  allowExternal?: boolean;
  downloadsOnly?: boolean;
}

/** Read-only recommendations from videos already owned by the instance. */
export async function recommendationFeed(uid: number, options: RecommendationFeedOptions = {}) {
  const page = Math.max(0, Math.floor(options.page ?? 0));
  const limit = Math.min(60, Math.max(1, Math.floor(options.limit ?? 40)));
  const settings = await discoverySettings(uid);
  const enabled = pluginEnabled("discovery");
  if (!enabled) return {
    enabled: false, external_enabled: false, recommendations: [], page, limit,
    has_more: false, summary: await recommendationSummary(uid),
  };

  // Rank and diversify the complete bounded pool before slicing pages. This
  // keeps page boundaries deterministic and lets lower-ranked channels fill
  // slots left by the per-channel cap.
  const local = await localRecommendations(uid, 300, settings, {
    allowExternal: false,
    downloadsOnly: options.downloadsOnly,
  });
  const ranked = mixRecommendations(local, 300, settings);
  const offset = page * limit;
  const recommendations = ranked.slice(offset, offset + limit);
  return {
    enabled,
    external_enabled: false,
    recommendations,
    page,
    limit,
    has_more: ranked.length > offset + limit,
    summary: await recommendationSummary(uid),
  };
}

function mixRecommendations(recommendations: DiscoveryRecommendation[], limit: number, settings: Record<string, number>) {
  return diversifyRecommendations(
    recommendations,
    Math.max(0, Math.floor(limit)),
    Math.max(1, Math.floor(settings.per_channel_limit ?? 5)),
  );
}

export async function dismissDiscoveryRecommendation(_uid: number, _videoId: string) {
  // Kept as a no-op for older clients. The current recommendation surface is
  // deliberately passive and does not maintain per-video decision state.
}
