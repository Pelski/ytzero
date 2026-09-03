export const FEED_BUILDER_LIMITS = {
  intervalRows: { min: 1, max: 50 },
  sectionPosition: { min: 0, max: 100 },
  columns: { min: 1, max: 12 },
  maxRecipes: 20,
  maxReferences: 250,
  maxRecipeName: 80,
  maxAgeDays: 183,
} as const;

export type FeedMode = "classic" | "composed";
export type FeedRecipeSequence = "ordered" | "random";
export type FeedRecipeMatch = "any" | "all";
export type FeedRecipeOrder = "feed" | "random";
export type FeedHiddenMode = "exclude" | "include" | "only";
export type FeedMediaMode = "inherit" | "include" | "exclude" | "only";

export interface FeedRecipeSources {
  channelIds: string[];
  tagUuids: string[];
  youtubePlaylistIds: string[];
  userPlaylistUuids: string[];
}

export interface FeedRecipe {
  id: string;
  name: string;
  enabled: boolean;
  sourceMode: "all" | "selected";
  match: FeedRecipeMatch;
  include: FeedRecipeSources;
  exclude: FeedRecipeSources;
  maxAgeDays: number;
  hiddenTags: FeedHiddenMode;
  shorts: FeedMediaMode;
  live: FeedMediaMode;
  membersOnly: FeedMediaMode;
  order: FeedRecipeOrder;
}

export interface FeedSystemSection {
  visible: boolean;
  afterStandardRows: number;
}

export interface FeedBuilderConfig {
  version: 1;
  revision: number;
  mode: FeedMode;
  intervalRows: number;
  recipeSequence: FeedRecipeSequence;
  sections: {
    continueWatching: FeedSystemSection;
    scheduled: FeedSystemSection;
  };
  recipes: FeedRecipe[];
}

export interface FeedBuilderInput extends Omit<FeedBuilderConfig, "version" | "revision"> {
  revision?: number;
}

export const EMPTY_FEED_RECIPE_SOURCES: Readonly<FeedRecipeSources> = Object.freeze({
  channelIds: [],
  tagUuids: [],
  youtubePlaylistIds: [],
  userPlaylistUuids: [],
});

export function defaultFeedBuilderConfig(): FeedBuilderConfig {
  return {
    version: 1,
    revision: 0,
    mode: "classic",
    intervalRows: 3,
    recipeSequence: "ordered",
    sections: {
      continueWatching: { visible: true, afterStandardRows: 0 },
      scheduled: { visible: true, afterStandardRows: 0 },
    },
    recipes: [],
  };
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? value as T : fallback;
}

function refs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))]
    .slice(0, FEED_BUILDER_LIMITS.maxReferences);
}

function sources(value: unknown): FeedRecipeSources {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    channelIds: refs(input.channelIds),
    tagUuids: refs(input.tagUuids),
    youtubePlaylistIds: refs(input.youtubePlaylistIds),
    userPlaylistUuids: refs(input.userPlaylistUuids),
  };
}

function section(value: unknown, fallback: FeedSystemSection): FeedSystemSection {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    visible: typeof input.visible === "boolean" ? input.visible : fallback.visible,
    afterStandardRows: boundedInteger(
      input.afterStandardRows,
      fallback.afterStandardRows,
      FEED_BUILDER_LIMITS.sectionPosition.min,
      FEED_BUILDER_LIMITS.sectionPosition.max,
    ),
  };
}

export function normalizeFeedRecipe(value: unknown, index = 0): FeedRecipe {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const fallbackId = `recipe-${index + 1}`;
  return {
    id: (typeof input.id === "string" && input.id.trim() ? input.id.trim() : fallbackId).slice(0, 100),
    name: (typeof input.name === "string" && input.name.trim() ? input.name.trim() : `Recipe ${index + 1}`)
      .slice(0, FEED_BUILDER_LIMITS.maxRecipeName),
    enabled: typeof input.enabled === "boolean" ? input.enabled : true,
    sourceMode: enumValue(input.sourceMode, ["all", "selected"], "selected"),
    match: enumValue(input.match, ["any", "all"], "any"),
    include: sources(input.include),
    exclude: sources(input.exclude),
    maxAgeDays: boundedInteger(input.maxAgeDays, 30, 1, FEED_BUILDER_LIMITS.maxAgeDays),
    hiddenTags: enumValue(input.hiddenTags, ["exclude", "include", "only"], "exclude"),
    shorts: enumValue(input.shorts, ["inherit", "include", "exclude", "only"], "inherit"),
    live: enumValue(input.live, ["inherit", "include", "exclude", "only"], "inherit"),
    membersOnly: enumValue(input.membersOnly, ["inherit", "include", "exclude", "only"], "inherit"),
    order: enumValue(input.order, ["feed", "random"], "feed"),
  };
}

export function normalizeFeedBuilderConfig(value: unknown, revision = 0): FeedBuilderConfig {
  const defaults = defaultFeedBuilderConfig();
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const rawSections = input.sections && typeof input.sections === "object"
    ? input.sections as Record<string, unknown>
    : {};
  const rawRecipes = Array.isArray(input.recipes) ? input.recipes : [];
  const seenIds = new Set<string>();
  const recipes = rawRecipes.slice(0, FEED_BUILDER_LIMITS.maxRecipes).map((item, index) => {
    const recipe = normalizeFeedRecipe(item, index);
    const baseId = recipe.id;
    let suffix = index + 1;
    while (seenIds.has(recipe.id)) {
      const addition = `-${suffix++}`;
      recipe.id = `${baseId.slice(0, 100 - addition.length)}${addition}`;
    }
    seenIds.add(recipe.id);
    return recipe;
  });
  return {
    version: 1,
    revision: boundedInteger(revision, 0, 0, Number.MAX_SAFE_INTEGER),
    mode: enumValue(input.mode, ["classic", "composed"], defaults.mode),
    intervalRows: boundedInteger(input.intervalRows, defaults.intervalRows, 1, 50),
    recipeSequence: enumValue(input.recipeSequence, ["ordered", "random"], defaults.recipeSequence),
    sections: {
      continueWatching: section(rawSections.continueWatching, defaults.sections.continueWatching),
      scheduled: section(rawSections.scheduled, defaults.sections.scheduled),
    },
    recipes,
  };
}

export function recipeHasSelectedSources(recipe: FeedRecipe): boolean {
  return Object.values(recipe.include).some((items) => items.length > 0);
}

export function feedRecipeWarnings(recipe: FeedRecipe): string[] {
  const warnings: string[] = [];
  if (recipe.sourceMode === "selected" && !recipeHasSelectedSources(recipe)) warnings.push("no-selected-sources");
  return warnings;
}
