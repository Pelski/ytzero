import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import {
  api,
  ApiError,
  type FeedBuilderConfig,
  type FeedBuilderOption,
  type FeedBuilderOptions,
  type FeedMediaMode,
  type FeedRecipe,
  type FeedRecipeSources,
} from "../../api";
import { emit } from "../../events";
import { useI18n } from "../../i18n";
import {
  Alert,
  Badge,
  Button,
  Field,
  FormActions,
  IconButton,
  Inline,
  Input,
  InputGroup,
  MultiSelectMenu,
  OptionPicker,
  OrderEditor,
  SelectMenu,
  SettingRow,
  SettingsSection,
  Switch,
  Text,
} from "../ui";
import "./FeedBuilderSettings.css";

const EMPTY_SOURCES = (): FeedRecipeSources => ({ channelIds: [], tagUuids: [], youtubePlaylistIds: [], userPlaylistUuids: [] });

function createRecipe(index: number, label: string): FeedRecipe {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `recipe-${Date.now()}-${index}`,
    name: `${label} ${index + 1}`,
    enabled: true,
    sourceMode: "selected",
    match: "any",
    include: EMPTY_SOURCES(),
    exclude: EMPTY_SOURCES(),
    maxAgeDays: 30,
    hiddenTags: "exclude",
    shorts: "inherit",
    live: "inherit",
    membersOnly: "inherit",
    order: "feed",
  };
}

function SourcePicker({
  label,
  values,
  options,
  onChange,
}: {
  label: string;
  values: string[];
  options: FeedBuilderOption[];
  onChange: (values: string[]) => void;
}) {
  const { t } = useI18n();
  return (
    <Field label={label}>
      <MultiSelectMenu
        searchable
        floating
        label={label}
        searchPlaceholder={t("feedBuilderSearchSources")}
        emptyLabel={t("feedBuilderNoneSelected")}
        values={values}
        options={options.map((option) => ({ value: option.id, label: option.label }))}
        summary={(selected) => selected.length === 0 ? t("feedBuilderNoneSelected") : t("feedBuilderSelectedCount", { count: selected.length })}
        onChange={onChange}
      />
    </Field>
  );
}

function RecipeEditor({
  recipe,
  options,
  onChange,
  onDelete,
  preview,
  previewing,
  previewError,
  onPreview,
}: {
  recipe: FeedRecipe;
  options: FeedBuilderOptions;
  onChange: (recipe: FeedRecipe) => void;
  onDelete: () => void;
  preview?: { count: number; canFillRow: boolean };
  previewing: boolean;
  previewError: boolean;
  onPreview: () => void;
}) {
  const { t } = useI18n();
  const patch = (next: Partial<FeedRecipe>) => onChange({ ...recipe, ...next });
  const patchSources = (side: "include" | "exclude", key: keyof FeedRecipeSources, values: string[]) => patch({
    [side]: { ...recipe[side], [key]: values },
  });
  const mediaOptions: Array<{ value: FeedMediaMode; label: string }> = [
    { value: "inherit", label: t("feedBuilderMediaInherit") },
    { value: "include", label: t("feedBuilderMediaInclude") },
    { value: "exclude", label: t("feedBuilderMediaExclude") },
    { value: "only", label: t("feedBuilderMediaOnly") },
  ];
  const sourceSets = [
    ["channelIds", options.channels, t("feedBuilderChannels")] as const,
    ["tagUuids", options.tags, t("feedBuilderTags")] as const,
    ["youtubePlaylistIds", options.youtubePlaylists, t("feedBuilderYoutubePlaylists")] as const,
    ["userPlaylistUuids", options.userPlaylists, t("feedBuilderPersonalPlaylists")] as const,
  ];
  return (
    <div className="feed-builder-recipe">
      <div className="feed-builder-recipe__header">
        <Input aria-label={t("feedBuilderRecipeName")} value={recipe.name} maxLength={80} onChange={(event) => patch({ name: event.target.value })} />
        <Switch ariaLabel={t("feedBuilderRecipeEnabled")} checked={recipe.enabled} onCheckedChange={(enabled) => patch({ enabled })} />
        <IconButton variant="ghost" label={t("feedBuilderDeleteRecipe")} icon={<Trash2 />} onClick={onDelete} />
      </div>

      <Field label={t("feedBuilderSourceScope")}>
        <OptionPicker
          columns={2}
          label={t("feedBuilderSourceScope")}
          value={recipe.sourceMode}
          onChange={(sourceMode) => patch({ sourceMode })}
          options={[
            { value: "all", label: t("feedBuilderAllSources"), description: t("feedBuilderAllSourcesHint") },
            { value: "selected", label: t("feedBuilderSelectedSources"), description: t("feedBuilderSelectedSourcesHint") },
          ]}
        />
      </Field>

      {recipe.sourceMode === "selected" && (
        <>
          <Field label={t("feedBuilderIncludeMatch")}>
            <OptionPicker
              columns={2}
              label={t("feedBuilderIncludeMatch")}
              value={recipe.match}
              onChange={(match) => patch({ match })}
              options={[
                { value: "any", label: t("feedBuilderMatchAny"), description: t("feedBuilderMatchAnyHint") },
                { value: "all", label: t("feedBuilderMatchAll"), description: t("feedBuilderMatchAllHint") },
              ]}
            />
          </Field>
          <div className="feed-builder-source-grid">
            <div className="feed-builder-source-column">
              <Text className="feed-builder-heading">{t("feedBuilderInclude")}</Text>
              {sourceSets.map(([key, items, label]) => <SourcePicker key={`include-${key}`} label={label} values={recipe.include[key]} options={[...items]} onChange={(values) => patchSources("include", key, values)} />)}
            </div>
            <div className="feed-builder-source-column">
              <Text className="feed-builder-heading">{t("feedBuilderExclude")}</Text>
              {sourceSets.map(([key, items, label]) => <SourcePicker key={`exclude-${key}`} label={label} values={recipe.exclude[key]} options={[...items]} onChange={(values) => patchSources("exclude", key, values)} />)}
            </div>
          </div>
        </>
      )}

      <div className="feed-builder-rule-grid">
        <Field label={t("feedBuilderMaxAge")} htmlFor={`feed-builder-max-age-${recipe.id}`} hint={t("feedBuilderMaxAgeHint")}>
          <InputGroup suffix={t("feedBuilderDays")}>
            <Input id={`feed-builder-max-age-${recipe.id}`} type="number" min={1} max={183} value={recipe.maxAgeDays} onChange={(event) => patch({ maxAgeDays: Math.max(1, Math.min(183, Number(event.target.value) || 1)) })} />
          </InputGroup>
        </Field>
        <Field label={t("feedBuilderHiddenTags")}>
          <SelectMenu label={t("feedBuilderHiddenTags")} value={recipe.hiddenTags} onChange={(hiddenTags) => patch({ hiddenTags })} options={[
            { value: "exclude", label: t("feedBuilderHiddenExclude") },
            { value: "include", label: t("feedBuilderHiddenInclude") },
            { value: "only", label: t("feedBuilderHiddenOnly") },
          ]} />
        </Field>
        {(["shorts", "live", "membersOnly"] as const).map((key) => (
          <Field key={key} label={t(key === "shorts" ? "feedBuilderShorts" : key === "live" ? "feedBuilderLive" : "feedBuilderMembersOnly")}>
            <SelectMenu label={t(key === "shorts" ? "feedBuilderShorts" : key === "live" ? "feedBuilderLive" : "feedBuilderMembersOnly")} value={recipe[key]} onChange={(value) => patch({ [key]: value })} options={mediaOptions} />
          </Field>
        ))}
        <Field label={t("feedBuilderVideoOrder")}>
          <SelectMenu label={t("feedBuilderVideoOrder")} value={recipe.order} onChange={(order) => patch({ order })} options={[
            { value: "feed", label: t("feedBuilderFeedOrder") },
            { value: "random", label: t("feedBuilderRandomOrder") },
          ]} />
        </Field>
      </div>

      {recipe.sourceMode === "selected" && Object.values(recipe.include).every((items) => items.length === 0) && (
        <Alert variant="warning" icon={<AlertTriangle />} title={t("feedBuilderRecipeNeedsSource")}>{t("feedBuilderRecipeNeedsSourceHint")}</Alert>
      )}
      <Inline gap={2} align="center" className="feed-builder-preview">
        <Button size="sm" disabled={previewing} onClick={onPreview}>{previewing ? t("loading") : t("feedBuilderPreview")}</Button>
        {preview && <Badge variant={preview.count === 0 ? "warning" : "neutral"}>{t("feedBuilderPreviewCount", { count: preview.count })}</Badge>}
        {previewError && <Text as="span" size="sm" tone="danger" role="alert">{t("feedBuilderPreviewError")}</Text>}
      </Inline>
    </div>
  );
}

export function FeedBuilderSettings({ showToast }: { showToast: (message: string) => void }) {
  const { t } = useI18n();
  const [config, setConfig] = useState<FeedBuilderConfig | null>(null);
  const [options, setOptions] = useState<FeedBuilderOptions>({ channels: [], tags: [], youtubePlaylists: [], userPlaylists: [] });
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [previews, setPreviews] = useState<Record<string, { count: number; canFillRow: boolean }>>({});
  const [previewing, setPreviewing] = useState<Record<string, boolean>>({});
  const [previewErrors, setPreviewErrors] = useState<Record<string, boolean>>({});
  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const [builder, available] = await Promise.all([api.feedBuilder(), api.feedBuilderOptions()]);
      setConfig(builder.config);
      setOptions(available);
    } catch (error) {
      setLoadError(true);
      throw error;
    }
  }, []);
  useEffect(() => { void load().catch(console.error); }, [load]);
  if (!config) return (
    <SettingsSection title={t("feedBuilderTitle")}>
      {loadError ? (
        <Alert variant="danger" title={t("feedBuilderLoadError")}>
          <Button size="sm" onClick={() => void load().catch(console.error)}>{t("feedBuilderRetry")}</Button>
        </Alert>
      ) : <Text tone="secondary">{t("loading")}</Text>}
    </SettingsSection>
  );
  const patch = (next: Partial<FeedBuilderConfig>) => setConfig({ ...config, ...next });
  const updateRecipe = (id: string, recipe: FeedRecipe) => {
    patch({ recipes: config.recipes.map((item) => item.id === id ? recipe : item) });
    setPreviews((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setPreviewErrors((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  };
  const save = async () => {
    setSaving(true);
    try {
      const result = await api.updateFeedBuilder(config, config.revision);
      setConfig(result.config);
      emit("feed-builder-changed");
      showToast(t("feedBuilderSaved"));
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        await load();
        showToast(t("feedBuilderConflict"));
      } else showToast(t("feedBuilderSaveError"));
    } finally { setSaving(false); }
  };
  const previewRecipe = async (recipe: FeedRecipe) => {
    setPreviewing((current) => ({ ...current, [recipe.id]: true }));
    setPreviewErrors((current) => ({ ...current, [recipe.id]: false }));
    try {
      const result = await api.previewFeedRecipe(recipe, 4);
      setPreviews((current) => ({ ...current, [recipe.id]: result }));
    } catch (error) {
      console.error(error);
      setPreviewErrors((current) => ({ ...current, [recipe.id]: true }));
    } finally {
      setPreviewing((current) => ({ ...current, [recipe.id]: false }));
    }
  };
  return (
    <SettingsSection title={t("feedBuilderTitle")} description={t("feedBuilderDescription")} className="feed-builder-settings">
      <Field label={t("feedBuilderMode")}>
        <OptionPicker columns={2} label={t("feedBuilderMode")} value={config.mode} onChange={(mode) => patch({ mode })} options={[
          { value: "classic", label: t("feedBuilderClassic"), description: t("feedBuilderClassicHint") },
          { value: "composed", label: t("feedBuilderComposed"), description: t("feedBuilderComposedHint") },
        ]} />
      </Field>
      {config.mode === "composed" && (
        <>
          <SettingRow label={t("feedBuilderInterval")} description={t("feedBuilderIntervalHint")} htmlFor="feed-builder-interval">
            <InputGroup suffix={t("feedBuilderRows")}><Input id="feed-builder-interval" type="number" min={1} max={50} value={config.intervalRows} onChange={(event) => patch({ intervalRows: Math.max(1, Math.min(50, Number(event.target.value) || 1)) })} /></InputGroup>
          </SettingRow>
          <SettingRow label={t("feedBuilderRecipeSequence")} description={t("feedBuilderRecipeSequenceHint")}>
            <SelectMenu label={t("feedBuilderRecipeSequence")} value={config.recipeSequence} onChange={(recipeSequence) => patch({ recipeSequence })} options={[
              { value: "ordered", label: t("feedBuilderSequenceOrdered") },
              { value: "random", label: t("feedBuilderSequenceRandom") },
            ]} />
          </SettingRow>
          {(["continueWatching", "scheduled"] as const).map((key) => (
            <SettingRow key={key} label={t(key === "continueWatching" ? "continueWatching" : "navWatchlist")} description={t("feedBuilderSystemSectionHint")}>
              <Inline gap={2} align="center">
                <Switch ariaLabel={t("feedBuilderSectionVisible")} checked={config.sections[key].visible} onCheckedChange={(visible) => patch({ sections: { ...config.sections, [key]: { ...config.sections[key], visible } } })} />
                <InputGroup suffix={t("feedBuilderRows")}><Input aria-label={t("feedBuilderAfterRows")} disabled={!config.sections[key].visible} type="number" min={0} max={100} value={config.sections[key].afterStandardRows} onChange={(event) => patch({ sections: { ...config.sections, [key]: { ...config.sections[key], afterStandardRows: Math.max(0, Math.min(100, Number(event.target.value) || 0)) } } })} /></InputGroup>
              </Inline>
            </SettingRow>
          ))}

          <div className="feed-builder-recipes-header">
            <div><Text className="feed-builder-heading">{t("feedBuilderRecipes")}</Text><Text tone="secondary">{t("feedBuilderRecipesHint")}</Text></div>
            <Button size="sm" leadingIcon={<Plus />} disabled={config.recipes.length >= 20} onClick={() => patch({ recipes: [...config.recipes, createRecipe(config.recipes.length, t("feedBuilderRecipe"))] })}>{t("feedBuilderAddRecipe")}</Button>
          </div>
          {config.recipes.length === 0 ? <Alert>{t("feedBuilderNoRecipes")}</Alert> : (
            <OrderEditor
              items={config.recipes}
              onChange={(recipes) => patch({ recipes })}
              moveUpLabel={t("feedBuilderMoveUp")}
              moveDownLabel={t("feedBuilderMoveDown")}
              renderItem={(recipe) => (
                <RecipeEditor
                  recipe={recipe}
                  options={options}
                  onChange={(next) => updateRecipe(recipe.id, next)}
                  onDelete={() => patch({ recipes: config.recipes.filter((item) => item.id !== recipe.id) })}
                  preview={previews[recipe.id]}
                  previewing={Boolean(previewing[recipe.id])}
                  previewError={Boolean(previewErrors[recipe.id])}
                  onPreview={() => void previewRecipe(recipe)}
                />
              )}
            />
          )}
        </>
      )}
      <FormActions><Button variant="primary" disabled={saving} onClick={save}>{saving ? t("loading") : t("save")}</Button></FormActions>
    </SettingsSection>
  );
}
