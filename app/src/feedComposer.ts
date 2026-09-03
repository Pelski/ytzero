import { database } from "./database";
import { getUserSetting } from "./db";
import { childHidesLive } from "./childTime";
import { appendShortsFeedVisibility, feedSortSql, feedSourceExists, feedVisibilityWhere } from "./feedQuery";
import { videoSelect, type VideoRow } from "./videoRoutesSupport";
import type {
  FeedBuilderConfig,
  FeedMediaMode,
  FeedRecipe,
  FeedRecipeSources,
} from "../../shared/feedBuilder";

export const COMPOSITION_TTL_MS = 2 * 60 * 60 * 1000;
export const STANDARD_ROWS_PER_PAGE = 8;

export interface FeedCompositionRequest {
  columns: number;
  tags?: number[];
  showAll?: boolean;
  sort?: "published" | "arrival";
  seed?: string;
}

export type FeedCompositionBlock =
  | { type: "standard-row"; videos: Array<VideoRow & Record<string, unknown>> }
  | { type: "recipe-row"; recipeId: string; title: string; videos: Array<VideoRow & Record<string, unknown>> }
  | { type: "continue"; videos: Array<VideoRow & Record<string, unknown>> }
  | { type: "scheduled"; videos: Array<VideoRow & Record<string, unknown>> };

export interface FeedCompositionPage {
  compositionId: string;
  seed: string;
  pageIndex: number;
  blocks: FeedCompositionBlock[];
  hasMore: boolean;
  nextPage: number | null;
}

interface ComposerState {
  nextPage: number;
  standardPosition: number;
  standardCandidates: string[];
  standardRows: number;
  seen: string[];
  playbackOrder: string[];
  systemVideoIds: { continueWatching: string[]; scheduled: string[] };
  systemPlaced: { continueWatching: boolean; scheduled: boolean };
  candidates: Record<string, string[]>;
  recipePositions: Record<string, number>;
  recipeCursor: number;
  recipeBag: string[];
  randomCycle: number;
}

type AttachTags = (userId: number, videos: VideoRow[]) => Promise<Array<VideoRow & Record<string, unknown>>>;

function placeholders(values: readonly unknown[]): string {
  return values.map(() => "?").join(",");
}

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const result = [...items];
  let state = hashSeed(seed) || 1;
  const random = () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
  for (let index = result.length - 1; index > 0; index--) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function groupExpressions(userId: number, refs: FeedRecipeSources): Array<{ sql: string; params: unknown[] }> {
  const expressions: Array<{ sql: string; params: unknown[] }> = [];
  if (refs.channelIds.length) {
    expressions.push({ sql: `v.channel_id IN (${placeholders(refs.channelIds)})`, params: refs.channelIds });
  }
  if (refs.tagUuids.length) {
    const ph = placeholders(refs.tagUuids);
    expressions.push({
      sql: `(EXISTS (
        SELECT 1 FROM video_tags recipe_vt JOIN tags recipe_t ON recipe_t.id=recipe_vt.tag_id
        WHERE recipe_vt.video_id=v.video_id AND recipe_t.user_id=? AND recipe_t.portable_uuid IN (${ph})
      ) OR EXISTS (
        SELECT 1 FROM channel_tags recipe_ct JOIN tags recipe_t ON recipe_t.id=recipe_ct.tag_id
        WHERE recipe_ct.channel_id=v.channel_id AND recipe_t.user_id=? AND recipe_t.portable_uuid IN (${ph})
      ) OR EXISTS (
        SELECT 1 FROM channel_playlist_videos recipe_cpv
        JOIN channel_playlists recipe_cp ON recipe_cp.playlist_id=recipe_cpv.playlist_id
        JOIN user_followed_playlists recipe_ufp ON recipe_ufp.playlist_id=recipe_cp.playlist_id AND recipe_ufp.user_id=?
        JOIN channel_tags recipe_ct ON recipe_ct.channel_id=recipe_cp.channel_id
        JOIN tags recipe_t ON recipe_t.id=recipe_ct.tag_id
        WHERE recipe_cpv.video_id=v.video_id AND recipe_t.user_id=? AND recipe_t.portable_uuid IN (${ph})
      ))`,
      params: [userId, ...refs.tagUuids, userId, ...refs.tagUuids, userId, userId, ...refs.tagUuids],
    });
  }
  if (refs.youtubePlaylistIds.length) {
    expressions.push({
      sql: `EXISTS (SELECT 1 FROM channel_playlist_videos recipe_cpv WHERE recipe_cpv.video_id=v.video_id AND recipe_cpv.playlist_id IN (${placeholders(refs.youtubePlaylistIds)}))`,
      params: refs.youtubePlaylistIds,
    });
  }
  if (refs.userPlaylistUuids.length) {
    expressions.push({
      sql: `EXISTS (
        SELECT 1 FROM user_playlist_videos recipe_upv
        JOIN user_playlists recipe_up ON recipe_up.id=recipe_upv.playlist_id
        WHERE recipe_upv.video_id=v.video_id AND recipe_up.user_id=? AND recipe_up.portable_uuid IN (${placeholders(refs.userPlaylistUuids)})
      )`,
      params: [userId, ...refs.userPlaylistUuids],
    });
  }
  return expressions;
}

function effectiveHiddenTagSql(userId: number): string {
  return `(EXISTS (
    SELECT 1 FROM video_tags hidden_vt JOIN tags hidden_t ON hidden_t.id=hidden_vt.tag_id
    WHERE hidden_vt.video_id=v.video_id AND hidden_t.user_id=${userId} AND hidden_t.filter_only=1
  ) OR EXISTS (
    SELECT 1 FROM channel_tags hidden_ct JOIN tags hidden_t ON hidden_t.id=hidden_ct.tag_id
    WHERE hidden_ct.channel_id=v.channel_id AND hidden_t.user_id=${userId} AND hidden_t.filter_only=1
  ) OR EXISTS (
    SELECT 1 FROM channel_playlist_videos hidden_cpv
    JOIN channel_playlists hidden_cp ON hidden_cp.playlist_id=hidden_cpv.playlist_id
    JOIN user_followed_playlists hidden_ufp ON hidden_ufp.playlist_id=hidden_cp.playlist_id AND hidden_ufp.user_id=${userId}
    JOIN channel_tags hidden_ct ON hidden_ct.channel_id=hidden_cp.channel_id
    JOIN tags hidden_t ON hidden_t.id=hidden_ct.tag_id
    WHERE hidden_cpv.video_id=v.video_id AND hidden_t.user_id=${userId} AND hidden_t.filter_only=1
  ))`;
}

function applyMediaMode(where: string[], mode: FeedMediaMode, positive: string, inheritedHidden: boolean): void {
  if (mode === "only") where.push(positive);
  else if (mode === "exclude" || (mode === "inherit" && inheritedHidden)) where.push(`NOT (${positive})`);
}

export function recipeWhere(recipe: FeedRecipe, userId: number): { where: string[]; params: unknown[] } {
  const where = [
    "COALESCE(v.is_unavailable, 0) = 0",
    "v.published_at IS NOT NULL AND v.published_at != ''",
    "COALESCE(uv.status, 'inbox') = 'inbox'",
    "COALESCE(uv.watched, 0) = 0",
    feedSourceExists(userId),
    "v.published_at >= ?",
  ];
  const cutoff = new Date(Date.now() - recipe.maxAgeDays * 86_400_000).toISOString();
  const params: unknown[] = [cutoff];
  const include = groupExpressions(userId, recipe.include);
  if (recipe.sourceMode === "selected") {
    if (include.length === 0) where.push("1 = 0");
    else {
      where.push(`(${include.map((entry) => entry.sql).join(recipe.match === "all" ? " AND " : " OR ")})`);
      include.forEach((entry) => params.push(...entry.params));
    }
  }
  const exclude = groupExpressions(userId, recipe.exclude);
  if (exclude.length) {
    where.push(`NOT (${exclude.map((entry) => entry.sql).join(" OR ")})`);
    exclude.forEach((entry) => params.push(...entry.params));
  }
  const hidden = effectiveHiddenTagSql(userId);
  if (recipe.hiddenTags === "exclude") where.push(`NOT (${hidden})`);
  if (recipe.hiddenTags === "only") where.push(hidden);
  if (recipe.shorts === "inherit") appendShortsFeedVisibility(where, userId);
  else applyMediaMode(where, recipe.shorts, "COALESCE(v.is_short, 0) = 1", false);
  if (childHidesLive(userId)) where.push("v.live_status NOT IN ('live', 'upcoming')");
  else applyMediaMode(where, recipe.live, "v.live_status IN ('live', 'upcoming')", getUserSetting(userId, "hide_live_from_feed") === "1");
  if (recipe.membersOnly === "inherit") {
    where.push(`NOT (
      v.members_only = 1 AND CASE COALESCE(
        (SELECT member_pref.members_only_visibility FROM user_channels member_pref
         WHERE member_pref.user_id = ${userId} AND member_pref.channel_id = v.channel_id), 'default'
      )
        WHEN 'channel' THEN 1 WHEN 'hidden' THEN 1 WHEN 'everywhere' THEN 0 WHEN 'feed' THEN 0 ELSE ?
      END = 1
    )`);
    params.push(getUserSetting(userId, "hide_members_only_from_feed") === "1" ? 1 : 0);
  } else applyMediaMode(where, recipe.membersOnly, "v.members_only = 1", false);
  return { where, params };
}

async function recipeCandidateIds(userId: number, recipe: FeedRecipe, seed: string): Promise<string[]> {
  const query = recipeWhere(recipe, userId);
  const rows = await database.prepare(`
    SELECT v.video_id
    FROM videos v JOIN channels c ON c.channel_id=v.channel_id
    LEFT JOIN user_videos uv ON uv.video_id=v.video_id AND uv.user_id=${userId}
    WHERE ${query.where.join(" AND ")}
    ORDER BY v.published_at DESC, v.video_id DESC
  `).all<{ video_id: string }>(...query.params);
  const ids = rows.map((row) => row.video_id);
  return recipe.order === "random" ? seededShuffle(ids, `${seed}:${recipe.id}:videos`) : ids;
}

async function standardCandidateIds(userId: number, request: FeedCompositionRequest): Promise<string[]> {
  const query = feedVisibilityWhere({
    tags: request.tags?.length ? request.tags.join(",") : undefined,
    show_all: request.showAll ? "1" : undefined,
  }, userId);
  const rows = await database.prepare(`
    SELECT v.video_id FROM videos v
    LEFT JOIN user_videos uv ON uv.video_id=v.video_id AND uv.user_id=${userId}
    WHERE ${query.where.join(" AND ")}
    ORDER BY ${feedSortSql(request.sort ?? "published")} DESC, v.video_id DESC
  `).all<{ video_id: string }>(...query.params);
  return rows.map((row) => row.video_id);
}

async function videosByIds(userId: number, ids: readonly string[], attachTags: AttachTags) {
  if (ids.length === 0) return [];
  const rows = await database.prepare(`${videoSelect(userId)} WHERE v.video_id IN (${placeholders(ids)})`)
    .all<VideoRow>(...ids);
  const byId = new Map(rows.map((row) => [row.video_id, row]));
  return attachTags(userId, ids.map((id) => byId.get(id)).filter((row): row is VideoRow => Boolean(row)));
}

async function systemVideoIds(userId: number): Promise<ComposerState["systemVideoIds"]> {
  const continuing = await database.prepare(`
    SELECT uv.video_id
    FROM user_videos uv
    JOIN videos v ON v.video_id=uv.video_id
    JOIN (SELECT video_id, MAX(watched_at) AS last_watched FROM history WHERE user_id=? GROUP BY video_id) lw ON lw.video_id=v.video_id
    WHERE uv.user_id=? AND v.published_at IS NOT NULL AND v.published_at!=''
      AND uv.watch_position IS NOT NULL AND uv.watch_duration IS NOT NULL AND uv.watch_duration>30
      AND uv.watch_position>=3 AND CAST(uv.watch_position AS REAL)/uv.watch_duration<0.92
      AND COALESCE(uv.status, 'inbox')='inbox' AND COALESCE(v.is_short, 0)=0
    ORDER BY lw.last_watched DESC LIMIT 20
  `).all<{ video_id: string }>(userId, userId);
  const scheduled = await database.prepare(`
    SELECT uv.video_id FROM user_videos uv JOIN videos v ON v.video_id=uv.video_id
    WHERE uv.user_id=? AND uv.status='queued' AND uv.bucket IS NOT NULL
      AND (uv.show_from IS NULL OR uv.show_from<=datetime('now'))
    ORDER BY CASE uv.bucket WHEN 'today' THEN 0 WHEN 'tonight' THEN 1 WHEN 'tomorrow' THEN 2 WHEN 'tomorrow_evening' THEN 3 ELSE 4 END,
      uv.show_from ASC, uv.queued_at DESC
  `).all<{ video_id: string }>(userId);
  return {
    continueWatching: continuing.map((row) => row.video_id),
    scheduled: scheduled.map((row) => row.video_id),
  };
}

function activeRecipes(config: FeedBuilderConfig): FeedRecipe[] {
  return config.recipes.filter((recipe) => recipe.enabled);
}

function recipeAttemptOrder(config: FeedBuilderConfig, state: ComposerState, seed: string): FeedRecipe[] {
  const recipes = activeRecipes(config);
  if (recipes.length === 0) return [];
  if (config.recipeSequence === "random") {
    const activeIds = new Set(recipes.map((recipe) => recipe.id));
    state.recipeBag = state.recipeBag.filter((id) => activeIds.has(id));
    if (state.recipeBag.length === 0) state.recipeBag = seededShuffle(recipes.map((recipe) => recipe.id), `${seed}:recipes:${state.randomCycle++}`);
    const byId = new Map(recipes.map((recipe) => [recipe.id, recipe]));
    return state.recipeBag.map((id) => byId.get(id)).filter((recipe): recipe is FeedRecipe => Boolean(recipe));
  }
  return recipes.map((_, index) => recipes[(state.recipeCursor + index) % recipes.length]);
}

async function nextRecipeBlock(
  userId: number,
  config: FeedBuilderConfig,
  state: ComposerState,
  columns: number,
  seed: string,
  attachTags: AttachTags,
): Promise<FeedCompositionBlock | null> {
  const seen = new Set(state.seen);
  const recipes = activeRecipes(config);
  for (const recipe of recipeAttemptOrder(config, state, seed)) {
    if (config.recipeSequence === "random") state.recipeBag = state.recipeBag.filter((id) => id !== recipe.id);
    const candidates = state.candidates[recipe.id] ?? [];
    let position = state.recipePositions[recipe.id] ?? 0;
    const ids: string[] = [];
    while (position < candidates.length && ids.length < columns) {
      const id = candidates[position++];
      if (!seen.has(id)) ids.push(id);
    }
    state.recipePositions[recipe.id] = position;
    if (ids.length !== columns) continue;
    ids.forEach((id) => { seen.add(id); state.seen.push(id); state.playbackOrder.push(id); });
    const recipeIndex = recipes.findIndex((item) => item.id === recipe.id);
    state.recipeCursor = recipeIndex < 0 ? state.recipeCursor : (recipeIndex + 1) % recipes.length;
    return { type: "recipe-row", recipeId: recipe.id, title: recipe.name, videos: await videosByIds(userId, ids, attachTags) };
  }
  return null;
}

async function nextStandardRow(
  userId: number,
  state: ComposerState,
  request: FeedCompositionRequest,
  attachTags: AttachTags,
): Promise<Array<VideoRow & Record<string, unknown>>> {
  const seen = new Set(state.seen);
  const selected: string[] = [];
  while (selected.length < request.columns && state.standardPosition < state.standardCandidates.length) {
    const id = state.standardCandidates[state.standardPosition++];
    if (!seen.has(id)) selected.push(id);
  }
  selected.forEach((id) => { state.seen.push(id); state.playbackOrder.push(id); });
  return videosByIds(userId, selected, attachTags);
}

async function appendDueSystemSections(
  userId: number,
  config: FeedBuilderConfig,
  state: ComposerState,
  blocks: FeedCompositionBlock[],
  attachTags: AttachTags,
): Promise<void> {
  const entries = [
    ["continueWatching", "continue"] as const,
    ["scheduled", "scheduled"] as const,
  ];
  for (const [key, type] of entries) {
    const settings = config.sections[key];
    if (!settings.visible || state.systemPlaced[key] || settings.afterStandardRows > state.standardRows) continue;
    const ids = state.systemVideoIds[key];
    state.systemPlaced[key] = true;
    if (ids.length) blocks.push({ type, videos: await videosByIds(userId, ids, attachTags) } as FeedCompositionBlock);
  }
}

async function buildPage(
  compositionId: string,
  userId: number,
  config: FeedBuilderConfig,
  request: FeedCompositionRequest,
  seed: string,
  state: ComposerState,
  attachTags: AttachTags,
): Promise<FeedCompositionPage> {
  const blocks: FeedCompositionBlock[] = [];
  let fullRows = 0;
  await appendDueSystemSections(userId, config, state, blocks, attachTags);
  while (fullRows < STANDARD_ROWS_PER_PAGE) {
    const row = await nextStandardRow(userId, state, request, attachTags);
    if (row.length === 0) break;
    blocks.push({ type: "standard-row", videos: row });
    if (row.length < request.columns) break;
    fullRows++;
    state.standardRows++;
    await appendDueSystemSections(userId, config, state, blocks, attachTags);
    if (state.standardRows % config.intervalRows === 0) {
      const recipe = await nextRecipeBlock(userId, config, state, request.columns, seed, attachTags);
      if (recipe) blocks.push(recipe);
    }
  }
  const hasMore = fullRows === STANDARD_ROWS_PER_PAGE;
  const pageIndex = state.nextPage++;
  return { compositionId, seed, pageIndex, blocks, hasMore, nextPage: hasMore ? state.nextPage : null };
}

export async function createComposition(
  userId: number,
  config: FeedBuilderConfig,
  rawRequest: FeedCompositionRequest,
  attachTags: AttachTags,
): Promise<FeedCompositionPage> {
  const request: FeedCompositionRequest = {
    columns: Math.max(1, Math.min(12, Math.round(Number(rawRequest.columns) || 1))),
    tags: Array.isArray(rawRequest.tags) ? rawRequest.tags.filter((id) => Number.isInteger(id) && id > 0).slice(0, 100) : [],
    showAll: Boolean(rawRequest.showAll),
    sort: rawRequest.sort === "arrival" ? "arrival" : "published",
    seed: typeof rawRequest.seed === "string" && rawRequest.seed ? rawRequest.seed.slice(0, 100) : crypto.randomUUID(),
  };
  const compositionId = crypto.randomUUID();
  const seed = request.seed!;
  const systems = await systemVideoIds(userId);
  const seen = config.sections.continueWatching.visible ? [...systems.continueWatching] : [];
  const candidates: Record<string, string[]> = {};
  for (const recipe of activeRecipes(config)) candidates[recipe.id] = await recipeCandidateIds(userId, recipe, seed);
  const standardCandidates = await standardCandidateIds(userId, request);
  const state: ComposerState = {
    nextPage: 0,
    standardPosition: 0,
    standardCandidates,
    standardRows: 0,
    seen,
    playbackOrder: [],
    systemVideoIds: systems,
    systemPlaced: { continueWatching: false, scheduled: false },
    candidates,
    recipePositions: {},
    recipeCursor: 0,
    recipeBag: [],
    randomCycle: 0,
  };
  const now = Date.now();
  const page = await buildPage(compositionId, userId, config, request, seed, state, attachTags);
  await database.transaction(async () => {
    await database.prepare("DELETE FROM feed_composition_sessions WHERE expires_at_ms <= ?").run(now);
    await database.prepare(`
      INSERT INTO feed_composition_sessions(id,user_id,config_revision,columns_count,seed,request_json,state_json,created_at_ms,last_accessed_at_ms,expires_at_ms)
      VALUES(?,?,?,?,?,?,?,?,?,?)
    `).run(compositionId, userId, config.revision, request.columns, seed, JSON.stringify(request), JSON.stringify(state), now, now, now + COMPOSITION_TTL_MS);
    await database.prepare("INSERT INTO feed_composition_pages(composition_id,page_index,response_json) VALUES(?,?,?)")
      .run(compositionId, page.pageIndex, JSON.stringify(page));
  })();
  return page;
}

export async function compositionPlaybackOrder(userId: number, compositionId: string): Promise<string[]> {
  const session = await database.prepare("SELECT state_json,expires_at_ms FROM feed_composition_sessions WHERE id=? AND user_id=?")
    .get<{ state_json: string; expires_at_ms: number }>(compositionId, userId);
  if (!session || session.expires_at_ms <= Date.now()) return [];
  try {
    const state = JSON.parse(session.state_json) as Partial<ComposerState>;
    return Array.isArray(state.playbackOrder) ? state.playbackOrder.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export async function compositionPage(
  userId: number,
  compositionId: string,
  pageIndex: number,
  config: FeedBuilderConfig,
  attachTags: AttachTags,
): Promise<FeedCompositionPage | "expired" | "invalid-page"> {
  const saved = await database.prepare(`
    SELECT page.response_json FROM feed_composition_pages page
    JOIN feed_composition_sessions session ON session.id=page.composition_id
    WHERE page.composition_id=? AND page.page_index=? AND session.user_id=? AND session.expires_at_ms>?
  `).get<{ response_json: string }>(compositionId, pageIndex, userId, Date.now());
  if (saved) return JSON.parse(saved.response_json) as FeedCompositionPage;
  const session = await database.prepare(`
    SELECT config_revision, seed, request_json, state_json, expires_at_ms
    FROM feed_composition_sessions WHERE id=? AND user_id=?
  `).get<{ config_revision: number; seed: string; request_json: string; state_json: string; expires_at_ms: number }>(compositionId, userId);
  if (!session || session.expires_at_ms <= Date.now() || session.config_revision !== config.revision) {
    if (session) await database.prepare("DELETE FROM feed_composition_sessions WHERE id=?").run(compositionId);
    return "expired";
  }
  const state = JSON.parse(session.state_json) as ComposerState;
  if (pageIndex !== state.nextPage) return "invalid-page";
  const request = JSON.parse(session.request_json) as FeedCompositionRequest;
  const page = await buildPage(compositionId, userId, config, request, session.seed, state, attachTags);
  const now = Date.now();
  await database.transaction(async () => {
    await database.prepare("UPDATE feed_composition_sessions SET state_json=?,last_accessed_at_ms=?,expires_at_ms=? WHERE id=? AND user_id=?")
      .run(JSON.stringify(state), now, now + COMPOSITION_TTL_MS, compositionId, userId);
    await database.prepare("INSERT INTO feed_composition_pages(composition_id,page_index,response_json) VALUES(?,?,?) ON CONFLICT(composition_id,page_index) DO NOTHING")
      .run(compositionId, page.pageIndex, JSON.stringify(page));
  })();
  return page;
}

export async function previewRecipe(userId: number, recipe: FeedRecipe, columns: number, attachTags: AttachTags) {
  const ids = await recipeCandidateIds(userId, recipe, "preview");
  return { count: ids.length, canFillRow: ids.length >= columns, videos: await videosByIds(userId, ids.slice(0, columns), attachTags) };
}
