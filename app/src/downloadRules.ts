import { database } from "./database";
import { getSetting, reloadSettingCache } from "./db";
import { shouldAutoDownloadVideo } from "./downloadContentPolicy";
import { dlSettings } from "./downloadConfig";

export type DownloadRuleSourceMode = "subscriptions" | "selected";
export type DownloadRuleKeywordMode = "any" | "all";
export type DownloadRuleField = "title" | "description" | "both";
export type DownloadRuleBackfill = "future" | "recent" | "all";

export interface DownloadRuleInput {
  name: string;
  enabled: boolean;
  source_mode: DownloadRuleSourceMode;
  channel_ids: string[];
  playlist_ids: string[];
  include_keywords: string[];
  exclude_keywords: string[];
  keyword_mode: DownloadRuleKeywordMode;
  match_field: DownloadRuleField;
  include_shorts: boolean;
  include_members_only: boolean;
  min_duration_seconds: number;
  backfill_mode: DownloadRuleBackfill;
  lookback_hours: number;
}

export interface DownloadRule extends DownloadRuleInput {
  id: number;
  portable_uuid: string;
  created_at: string;
  updated_at: string;
}

export class DownloadRuleValidationError extends Error {}

interface RuleRow {
  id: number;
  portable_uuid: string;
  user_id: number;
  name: string;
  enabled: number;
  source_mode: DownloadRuleSourceMode;
  channel_ids_json: string;
  playlist_ids_json: string;
  include_keywords_json: string;
  exclude_keywords_json: string;
  keyword_mode: DownloadRuleKeywordMode;
  match_field: DownloadRuleField;
  include_shorts: number;
  include_members_only: number;
  min_duration_seconds: number;
  backfill_mode: DownloadRuleBackfill;
  lookback_hours: number;
  created_at: string;
  updated_at: string;
}

export interface DownloadRulePreviewVideo {
  video_id: string;
  title: string;
  thumbnail: string;
  channel_id: string;
  channel_title: string;
  published_at: string | null;
  download_status: string | null;
}

function stringList(value: unknown, maxItems = 250): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean))].slice(0, maxItems);
}

function parseList(raw: string): string[] {
  try { return stringList(JSON.parse(raw)); } catch { return []; }
}

function normalizeRule(value: Partial<DownloadRuleInput>): DownloadRuleInput {
  const sourceMode = value.source_mode === "subscriptions" ? "subscriptions" : "selected";
  const backfillMode = value.backfill_mode === "all" || value.backfill_mode === "recent" ? value.backfill_mode : "future";
  const name = typeof value.name === "string" && value.name.trim() ? value.name.trim().slice(0, 120) : "Download rule";
  return {
    name,
    enabled: value.enabled !== false,
    source_mode: sourceMode,
    channel_ids: stringList(value.channel_ids),
    playlist_ids: stringList(value.playlist_ids),
    include_keywords: stringList(value.include_keywords, 50).map((item) => item.slice(0, 120)),
    exclude_keywords: stringList(value.exclude_keywords, 50).map((item) => item.slice(0, 120)),
    keyword_mode: value.keyword_mode === "all" ? "all" : "any",
    match_field: value.match_field === "description" || value.match_field === "both" ? value.match_field : "title",
    include_shorts: value.include_shorts === true,
    include_members_only: value.include_members_only === true,
    min_duration_seconds: Math.max(0, Math.min(24 * 60 * 60, Math.floor(Number(value.min_duration_seconds) || 0))),
    backfill_mode: backfillMode,
    lookback_hours: Math.max(1, Math.min(24 * 365, Math.floor(Number(value.lookback_hours) || 48))),
  };
}

function assertValidRule(value: Partial<DownloadRuleInput>): void {
  if (typeof value.name !== "string" || !value.name.trim()) throw new DownloadRuleValidationError("rule name is required");
  const rule = normalizeRule(value);
  if (rule.source_mode === "selected" && rule.channel_ids.length === 0 && rule.playlist_ids.length === 0) {
    throw new DownloadRuleValidationError("at least one channel or playlist is required");
  }
}

function fromRow(row: RuleRow): DownloadRule {
  return {
    id: Number(row.id),
    portable_uuid: row.portable_uuid,
    ...normalizeRule({
      name: row.name,
      enabled: row.enabled === 1,
      source_mode: row.source_mode,
      channel_ids: parseList(row.channel_ids_json),
      playlist_ids: parseList(row.playlist_ids_json),
      include_keywords: parseList(row.include_keywords_json),
      exclude_keywords: parseList(row.exclude_keywords_json),
      keyword_mode: row.keyword_mode,
      match_field: row.match_field,
      include_shorts: row.include_shorts === 1,
      include_members_only: row.include_members_only === 1,
      min_duration_seconds: row.min_duration_seconds,
      backfill_mode: row.backfill_mode,
      lookback_hours: row.lookback_hours,
    }),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function listDownloadRules(userId?: number): Promise<DownloadRule[]> {
  const rows = userId == null
    ? await database.prepare("SELECT * FROM download_rules ORDER BY created_at, id").all()
    : await database.prepare("SELECT * FROM download_rules WHERE user_id=? ORDER BY created_at, id").all(userId);
  return (rows as RuleRow[]).map(fromRow);
}

export async function createDownloadRule(userId: number, value: Partial<DownloadRuleInput>): Promise<DownloadRule> {
  assertValidRule(value);
  const rule = normalizeRule(value);
  const row = await database.prepare(`
    INSERT INTO download_rules (
      portable_uuid, user_id, name, enabled, source_mode, channel_ids_json, playlist_ids_json,
      include_keywords_json, exclude_keywords_json, keyword_mode, match_field,
      include_shorts, include_members_only, min_duration_seconds, backfill_mode, lookback_hours
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *
  `).get(
    crypto.randomUUID(), userId, rule.name, rule.enabled ? 1 : 0, rule.source_mode,
    JSON.stringify(rule.channel_ids), JSON.stringify(rule.playlist_ids),
    JSON.stringify(rule.include_keywords), JSON.stringify(rule.exclude_keywords),
    rule.keyword_mode, rule.match_field, rule.include_shorts ? 1 : 0,
    rule.include_members_only ? 1 : 0, rule.min_duration_seconds,
    rule.backfill_mode, rule.lookback_hours,
  ) as RuleRow;
  return fromRow(row);
}

export async function updateDownloadRule(userId: number, id: number, value: Partial<DownloadRuleInput>): Promise<DownloadRule | null> {
  const current = await database.prepare("SELECT * FROM download_rules WHERE id = ? AND user_id = ?").get(id, userId) as RuleRow | null;
  if (!current) return null;
  const merged = { ...fromRow(current), ...value };
  assertValidRule(merged);
  const rule = normalizeRule(merged);
  const row = await database.prepare(`
    UPDATE download_rules SET
      name=?, enabled=?, source_mode=?, channel_ids_json=?, playlist_ids_json=?,
      include_keywords_json=?, exclude_keywords_json=?, keyword_mode=?, match_field=?,
      include_shorts=?, include_members_only=?, min_duration_seconds=?, backfill_mode=?,
      lookback_hours=?, updated_at=datetime('now')
    WHERE id=? AND user_id=? RETURNING *
  `).get(
    rule.name, rule.enabled ? 1 : 0, rule.source_mode,
    JSON.stringify(rule.channel_ids), JSON.stringify(rule.playlist_ids),
    JSON.stringify(rule.include_keywords), JSON.stringify(rule.exclude_keywords),
    rule.keyword_mode, rule.match_field, rule.include_shorts ? 1 : 0,
    rule.include_members_only ? 1 : 0, rule.min_duration_seconds,
    rule.backfill_mode, rule.lookback_hours, id, userId,
  ) as RuleRow;
  return fromRow(row);
}

export async function deleteDownloadRule(userId: number, id: number): Promise<boolean> {
  return (await database.prepare("DELETE FROM download_rules WHERE id=? AND user_id=?").run(id, userId)).changes > 0;
}

function parseDurationSeconds(raw: string | null): number | null {
  if (!raw) return null;
  const parts = raw.split(":").map(Number);
  if (!parts.length || parts.some((part) => !Number.isFinite(part))) return null;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function matchesKeywords(rule: DownloadRuleInput, title: string, description: string): boolean {
  const text = rule.match_field === "description" ? description : rule.match_field === "both" ? `${title}\n${description}` : title;
  const normalized = text.toLocaleLowerCase();
  const includes = rule.include_keywords.map((keyword) => keyword.toLocaleLowerCase());
  const excludes = rule.exclude_keywords.map((keyword) => keyword.toLocaleLowerCase());
  if (excludes.some((keyword) => normalized.includes(keyword))) return false;
  if (!includes.length) return true;
  return rule.keyword_mode === "all"
    ? includes.every((keyword) => normalized.includes(keyword))
    : includes.some((keyword) => normalized.includes(keyword));
}

function placeholders(values: readonly unknown[]) { return values.map(() => "?").join(","); }

export async function previewDownloadRule(userId: number, value: Partial<DownloadRuleInput>, limit = 8, readyOnly = false) {
  const rule = normalizeRule(value);
  const sourceWhere: string[] = [];
  const params: unknown[] = [];
  if (rule.source_mode === "subscriptions") {
    const exceptions = rule.channel_ids.length ? ` AND v.channel_id NOT IN (${placeholders(rule.channel_ids)})` : "";
    sourceWhere.push(`EXISTS (SELECT 1 FROM user_channels rule_follow WHERE rule_follow.user_id=? AND rule_follow.channel_id=v.channel_id AND rule_follow.followed=1)${exceptions}`);
    params.push(userId, ...rule.channel_ids);
  } else {
    if (rule.channel_ids.length) {
      sourceWhere.push(`v.channel_id IN (${placeholders(rule.channel_ids)})`);
      params.push(...rule.channel_ids);
    }
    if (rule.playlist_ids.length) {
      sourceWhere.push(`EXISTS (SELECT 1 FROM channel_playlist_videos rule_playlist WHERE rule_playlist.video_id=v.video_id AND rule_playlist.playlist_id IN (${placeholders(rule.playlist_ids)}))`);
      params.push(...rule.playlist_ids);
    }
  }
  if (!sourceWhere.length) return { matches: 0, ready: 0, existing: 0, sample: [] as DownloadRulePreviewVideo[], limited: false };

  const timeWhere = rule.backfill_mode === "future"
    ? `AND replace(substr(v.published_at, 1, 19), 'T', ' ') >= replace(substr(?, 1, 19), 'T', ' ')
       AND NOT EXISTS (
         SELECT 1 FROM user_channels future_follow
         WHERE future_follow.user_id=? AND future_follow.channel_id=v.channel_id
           AND future_follow.followed=1
           AND replace(substr(v.published_at, 1, 19), 'T', ' ') < replace(substr(future_follow.added_at, 1, 19), 'T', ' ')
       )`
    : rule.backfill_mode === "recent"
      ? "AND v.published_at >= datetime('now', ?)"
      : "";
  if (rule.backfill_mode === "future") {
    const createdAt = typeof (value as Partial<DownloadRule>).created_at === "string"
      ? (value as Partial<DownloadRule>).created_at!
      : new Date().toISOString().slice(0, 19).replace("T", " ");
    params.push(createdAt, userId);
  } else if (rule.backfill_mode === "recent") params.push(`-${rule.lookback_hours} hours`);

  const includeLiveArchives = (await dlSettings(userId)).download_live_archives;
  const rows = await database.prepare(`
    SELECT v.video_id, v.title, v.description, v.thumbnail, v.channel_id,
           COALESCE(NULLIF(c.custom_title, ''), c.title) AS channel_title,
           v.published_at, v.duration, v.is_short, v.members_only,
           CASE WHEN owner.video_id IS NOT NULL THEN d.status ELSE NULL END AS download_status
    FROM videos v
    JOIN channels c ON c.channel_id=v.channel_id
    LEFT JOIN downloads d ON d.video_id=v.video_id
    LEFT JOIN download_owners owner ON owner.video_id=v.video_id AND owner.user_id=?
    WHERE (v.live_status='none' OR (v.live_status='was_live' AND ?=1)) AND v.is_private=0 AND v.external=0
      AND (${sourceWhere.join(" OR ")})
      ${timeWhere}
      ${readyOnly ? "AND owner.video_id IS NULL" : ""}
      AND NOT EXISTS (
        SELECT 1 FROM user_videos rule_user_video
        WHERE rule_user_video.user_id=? AND rule_user_video.video_id=v.video_id
          AND (rule_user_video.watched=1 OR rule_user_video.status='archived')
      )
    ORDER BY COALESCE(v.published_at, v.created_at) DESC
    LIMIT 2001
  `).all(userId, includeLiveArchives, ...params, userId) as (DownloadRulePreviewVideo & { description: string; duration: string | null; is_short: number | null; members_only: number })[];

  const matching = rows.filter((row) => {
    if (!rule.include_shorts && row.is_short !== 0) return false;
    if (!rule.include_members_only && row.members_only === 1) return false;
    const seconds = parseDurationSeconds(row.duration);
    if (rule.min_duration_seconds > 0 && (seconds == null || seconds < rule.min_duration_seconds)) return false;
    return matchesKeywords(rule, row.title, row.description);
  });
  const existing = matching.filter((row) => row.download_status != null).length;
  const prioritized = matching.slice().sort((a, b) => Number(a.download_status != null) - Number(b.download_status != null));
  return {
    matches: matching.length,
    ready: matching.length - existing,
    existing,
    sample: prioritized.slice(0, Math.max(1, Math.min(100, limit))).map(({ description: _description, duration: _duration, is_short: _short, members_only: _members, ...row }) => row),
    limited: rows.length > 2000,
  };
}

export async function automaticDownloadCandidates(limit = 50): Promise<{ video_id: string; rule_id: number; user_id: number }[]> {
  const rows = await database.prepare("SELECT DISTINCT user_id FROM download_rules WHERE enabled=1 AND user_id IS NOT NULL").all() as { user_id: number }[];
  const seen = new Set<string>();
  const result: { video_id: string; rule_id: number; user_id: number }[] = [];
  for (const { user_id } of rows) {
    const includeShorts = (await dlSettings(user_id)).download_shorts === 1;
    for (const rule of (await listDownloadRules(user_id)).filter((entry) => entry.enabled)) {
      const preview = await previewDownloadRule(user_id, rule, limit, true);
      for (const video of preview.sample) {
        const row = await database.prepare("SELECT is_short FROM videos WHERE video_id=?").get(video.video_id) as { is_short: number | null } | null;
        if (!shouldAutoDownloadVideo(row?.is_short ?? null, includeShorts)) continue;
        const key = `${user_id}:${video.video_id}`;
        if (video.download_status != null || seen.has(key)) continue;
        seen.add(key);
        result.push({ video_id: video.video_id, rule_id: rule.id, user_id });
        if (result.length >= limit) return result;
      }
    }
  }
  return result;
}

export async function migrateLegacyDownloadAutomation(): Promise<void> {
  if (getSetting("download_rules_migrated") === "1") return;
  const primary = (await database.prepare("SELECT id FROM users ORDER BY id LIMIT 1").get() as { id: number }).id;
  const legacySettings = await dlSettings(primary);
  const existing = (await database.prepare("SELECT COUNT(*) AS n FROM download_rules").get() as { n: number }).n;
  if (existing === 0 && legacySettings.download_feed === 1) {
    const overrides = await database.prepare("SELECT channel_id, auto_download_min_duration_override AS seconds FROM channels WHERE auto_download_min_duration_override IS NOT NULL").all() as { channel_id: string; seconds: number }[];
    await createDownloadRule(primary, {
      name: "All subscriptions",
      enabled: true,
      source_mode: "subscriptions",
      // For a subscriptions rule channel_ids are explicit exceptions. Separate
      // selected-channel rules below preserve the previous per-channel value.
      channel_ids: overrides.map((row) => row.channel_id),
      playlist_ids: [],
      include_keywords: [],
      exclude_keywords: [],
      keyword_mode: "any",
      match_field: "title",
      include_shorts: legacySettings.download_shorts === 1,
      include_members_only: false,
      min_duration_seconds: Math.max(0, legacySettings.feed_min_duration_minutes * 60),
      backfill_mode: "recent",
      lookback_hours: Math.max(1, legacySettings.feed_max_age_hours),
    });
    const byMinimum = new Map<number, string[]>();
    for (const row of overrides) {
      // The old channel menu called zero "Off". Honour that user-facing intent
      // instead of preserving the old scheduler bug that treated it as no limit.
      if (Number(row.seconds) <= 0) continue;
      const seconds = Math.max(0, Number(row.seconds));
      byMinimum.set(seconds, [...(byMinimum.get(seconds) ?? []), row.channel_id]);
    }
    for (const [seconds, channelIds] of byMinimum) {
      await createDownloadRule(primary, {
        name: `Channel override · ≥ ${Math.round(seconds / 60)} min`,
        enabled: true,
        source_mode: "selected",
        channel_ids: channelIds,
        playlist_ids: [],
        include_keywords: [],
        exclude_keywords: [],
        keyword_mode: "any",
        match_field: "title",
        include_shorts: legacySettings.download_shorts === 1,
        include_members_only: false,
        min_duration_seconds: seconds,
        backfill_mode: "recent",
        lookback_hours: Math.max(1, legacySettings.feed_max_age_hours),
      });
    }
  }
  await database.prepare("INSERT INTO settings(key,value) VALUES('download_rules_migrated','1') ON CONFLICT(key) DO UPDATE SET value='1'").run();
  await reloadSettingCache();
}

export async function restoreDownloadRules(userId: number, values: unknown): Promise<void> {
  if (!Array.isArray(values)) return;
  for (const value of values.slice(0, 500)) {
    if (!value || typeof value !== "object") continue;
    const input = value as Partial<DownloadRule>;
    const uuid = typeof input.portable_uuid === "string" && /^[0-9a-f-]{36}$/i.test(input.portable_uuid)
      ? input.portable_uuid
      : crypto.randomUUID();
    const existing = await database.prepare("SELECT id FROM download_rules WHERE portable_uuid=? AND user_id=?").get(uuid, userId) as { id: number } | null;
    if (existing) {
      await updateDownloadRule(userId, existing.id, input);
      continue;
    }
    const rule = normalizeRule(input);
    await database.prepare(`
      INSERT INTO download_rules (
        portable_uuid, user_id, name, enabled, source_mode, channel_ids_json, playlist_ids_json,
        include_keywords_json, exclude_keywords_json, keyword_mode, match_field,
        include_shorts, include_members_only, min_duration_seconds, backfill_mode, lookback_hours
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuid, userId, rule.name, rule.enabled ? 1 : 0, rule.source_mode,
      JSON.stringify(rule.channel_ids), JSON.stringify(rule.playlist_ids),
      JSON.stringify(rule.include_keywords), JSON.stringify(rule.exclude_keywords),
      rule.keyword_mode, rule.match_field, rule.include_shorts ? 1 : 0,
      rule.include_members_only ? 1 : 0, rule.min_duration_seconds,
      rule.backfill_mode, rule.lookback_hours,
    );
  }
}
