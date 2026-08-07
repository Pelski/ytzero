import { database } from "./database";
import { getSetting, reloadSettingCache } from "./db";
import { DL_DEFAULTS, DOWNLOADS_ADMIN_SETTING_KEYS, DOWNLOADS_SETTINGS, localizeDownloadSettings, type DlSettings, type DownloadSettingSource, type DownloadSettingValue } from "./downloadSettings";

// ---------- settings ----------

function normalizeDownloadSetting(raw: unknown, definition: DownloadSettingSource): DownloadSettingValue {
  const type = definition.type ?? "slider";
  if (type === "select") {
    const value = String(raw ?? "");
    return definition.options?.some((option) => option.value === value) ? value : definition.defaultValue;
  }
  if (type === "text") {
    const value = typeof raw === "string" ? raw.trim() : "";
    return value || definition.defaultValue;
  }
  if (type === "time") {
    const value = typeof raw === "string" ? raw.trim() : "";
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : definition.defaultValue;
  }
  if (type === "multiselect") {
    const valid = new Set((definition.options ?? []).map((option) => option.value));
    const picked = typeof raw === "string"
      ? [...new Set(raw.split(",").map((item) => item.trim()).filter((item) => valid.has(item)))]
      : [];
    return picked.length > 0 ? picked.join(",") : definition.defaultValue;
  }
  const number = Number(raw);
  const fallback = Number(definition.defaultValue);
  const value = raw != null && Number.isFinite(number) ? number : fallback;
  if (type === "toggle") return value === 1 ? 1 : 0;
  return Math.min(definition.max ?? value, Math.max(definition.min ?? value, value));
}

export async function downloadSettings(userId: number, language?: string | null) {
  const values = new Map<string, string>();
  for (const row of await database.prepare("SELECT key,value FROM download_settings WHERE user_id=?").all(userId) as { key: string; value: string }[]) {
    values.set(row.key, row.value);
  }
  const settings: Record<string, DownloadSettingValue> = {};
  for (const definition of DOWNLOADS_SETTINGS) {
    const raw = DOWNLOADS_ADMIN_SETTING_KEYS.has(definition.key)
      ? getSetting(`downloads_${definition.key}`)
      : values.get(definition.key);
    settings[definition.key] = normalizeDownloadSetting(raw, definition);
  }
  return { definitions: localizeDownloadSettings(language), settings };
}

export async function setDownloadSettings(userId: number, patch: Record<string, unknown>, language?: string | null) {
  const definitions = new Map(DOWNLOADS_SETTINGS.map((definition) => [definition.key, definition]));
  let changedGlobalSetting = false;
  await database.transaction(async () => {
    for (const [key, raw] of Object.entries(patch)) {
      const definition = definitions.get(key);
      if (!definition) continue;
      const value = String(normalizeDownloadSetting(raw, definition));
      if (DOWNLOADS_ADMIN_SETTING_KEYS.has(key)) {
        await database.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
          .run(`downloads_${key}`, value);
        changedGlobalSetting = true;
      } else {
        await database.prepare("INSERT INTO download_settings(user_id,key,value) VALUES(?,?,?) ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value")
          .run(userId, key, value);
      }
    }
  })();
  if (changedGlobalSetting) await reloadSettingCache();
  return downloadSettings(userId, language);
}

export async function profileDownloadsEnabled(userId: number): Promise<boolean> {
  const row = await database.prepare("SELECT value FROM download_settings WHERE user_id=? AND key='enabled'").get(userId) as { value: string } | null;
  return row?.value === "1";
}

export async function setProfileDownloadsEnabled(userId: number, enabled: boolean): Promise<void> {
  await database.prepare("INSERT INTO download_settings(user_id,key,value) VALUES(?,'enabled',?) ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value")
    .run(userId, enabled ? "1" : "0");
}

/** Move every downloads-owned value out of the optional-plugin schema. The
 * transaction is idempotent and deletes legacy rows only after their domain
 * replacements exist. */
export async function migrateDownloadsFromPlugin(): Promise<void> {
  if (getSetting("downloads_domain_migrated") === "1") return;
  await database.transaction(async () => {
    const legacyPlugin = await database.prepare("SELECT enabled FROM plugins WHERE id='downloads'").get() as { enabled: number } | null;
    const globallyEnabled = legacyPlugin?.enabled === 1;
    const users = await database.prepare("SELECT id FROM users").all() as { id: number }[];
    for (const user of users) {
      const legacyValues = await database.prepare("SELECT key,value FROM plugin_settings WHERE plugin_id='downloads' AND user_id=?").all(user.id) as { key: string; value: string }[];
      const legacyEnabled = legacyValues.find((row) => row.key === "profile_enabled")?.value !== "0";
      await database.prepare("INSERT INTO download_settings(user_id,key,value) VALUES(?,'enabled',?) ON CONFLICT(user_id,key) DO NOTHING")
        .run(user.id, globallyEnabled && legacyEnabled ? "1" : "0");
      for (const row of legacyValues) {
        if (row.key === "profile_enabled" || !DOWNLOADS_SETTINGS.some((definition) => definition.key === row.key) || DOWNLOADS_ADMIN_SETTING_KEYS.has(row.key)) continue;
        await database.prepare("INSERT INTO download_settings(user_id,key,value) VALUES(?,?,?) ON CONFLICT(user_id,key) DO NOTHING")
          .run(user.id, row.key, row.value);
      }
      for (const definition of DOWNLOADS_SETTINGS) {
        if (DOWNLOADS_ADMIN_SETTING_KEYS.has(definition.key) || legacyValues.some((row) => row.key === definition.key)) continue;
        const legacyGlobal = await database.prepare("SELECT value FROM settings WHERE key=?").get(`plugin_downloads_${definition.key}`) as { value: string } | null;
        if (legacyGlobal) await database.prepare("INSERT INTO download_settings(user_id,key,value) VALUES(?,?,?) ON CONFLICT(user_id,key) DO NOTHING")
          .run(user.id, definition.key, legacyGlobal.value);
      }
    }
    for (const key of DOWNLOADS_ADMIN_SETTING_KEYS) {
      const legacy = await database.prepare("SELECT value FROM settings WHERE key=?").get(`plugin_downloads_${key}`) as { value: string } | null;
      if (legacy) await database.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO NOTHING").run(`downloads_${key}`, legacy.value);
    }
    await database.prepare("DELETE FROM plugin_settings WHERE plugin_id='downloads'").run();
    await database.prepare("DELETE FROM plugin_state WHERE plugin_id='downloads'").run();
    await database.prepare("DELETE FROM plugins WHERE id='downloads'").run();
    await database.prepare("DELETE FROM settings WHERE key LIKE 'plugin_downloads_%'").run();
    await database.prepare("INSERT INTO settings(key,value) VALUES('downloads_domain_migrated','1') ON CONFLICT(key) DO UPDATE SET value='1'").run();
  })();
  await reloadSettingCache();
}

export async function dlSettings(userId?: number): Promise<DlSettings> {
  const profileValues = new Map<string, string>();
  if (userId != null) {
    const rows = await database.prepare("SELECT key,value FROM download_settings WHERE user_id=?").all(userId) as { key: string; value: string }[];
    for (const row of rows) profileValues.set(row.key, row.value);
  }
  const out: Record<string, number | string> = {};
  for (const [key, def] of Object.entries(DL_DEFAULTS)) {
    const raw = DOWNLOADS_ADMIN_SETTING_KEYS.has(key)
      ? getSetting(`downloads_${key}`)
      : profileValues.get(key);
    if (raw == null) { out[key] = def; continue; }
    out[key] = typeof def === "number" ? (Number.isFinite(Number(raw)) ? Number(raw) : def) : raw;
  }
  return out as DlSettings;
}

export async function dlEnabled(userId?: number): Promise<boolean> {
  if (userId != null) return profileDownloadsEnabled(userId);
  return Boolean(await database.prepare("SELECT 1 AS enabled FROM download_settings WHERE key='enabled' AND value='1' LIMIT 1").get());
}
