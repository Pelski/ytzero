import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Download, Pencil, Plus, Trash2, X } from "lucide-react";
import { api, type DownloadAutomationOptions, type DownloadRule, type DownloadRuleInput, type DownloadRulePreview } from "../api";
import { formatChannelCount, formatPlaylistCount, useI18n } from "../i18n";
import Popconfirm from "./Popconfirm";
import { Alert, Badge, Button, Checkbox, EmptyState, FormActions, IconButton, Input, InputGroup, MultiSelectMenu, OptionPicker, SegmentedControl, SelectMenu, SettingRow, SettingsSection, Switch, Textarea } from "./ui";
import { handleVideoThumbnailError, videoThumbnail } from "../img";
import "./DownloadAutomation.css";

const EMPTY_RULE: DownloadRuleInput = {
  name: "",
  enabled: true,
  source_mode: "selected",
  channel_ids: [],
  playlist_ids: [],
  include_keywords: [],
  exclude_keywords: [],
  keyword_mode: "any",
  match_field: "title",
  include_shorts: false,
  include_members_only: false,
  min_duration_seconds: 0,
  backfill_mode: "future",
  lookback_hours: 48,
};

function keywordText(values: string[]) { return values.join("\n"); }
function parseKeywords(value: string) { return [...new Set(value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean))]; }
export default function DownloadAutomation({ shortsEnabled }: { shortsEnabled: boolean }) {
  const { t, language } = useI18n();
  const [rules, setRules] = useState<DownloadRule[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [options, setOptions] = useState<DownloadAutomationOptions>({ channels: [], playlists: [] });
  const [editingId, setEditingId] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState<DownloadRuleInput>(EMPTY_RULE);
  const [includeText, setIncludeText] = useState("");
  const [excludeText, setExcludeText] = useState("");
  const [preview, setPreview] = useState<DownloadRulePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const previewRequest = useRef(0);
  const [previewError, setPreviewError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    Promise.all([api.downloadRules(), api.downloadAutomationOptions()])
      .then(([ruleResult, optionResult]) => { setRules(ruleResult.rules); setCanManage(ruleResult.can_manage); setOptions(optionResult); })
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setLoaded(true));
  }, []);
  useEffect(load, [load]);

  const sourceReady = draft.source_mode === "subscriptions" || draft.channel_ids.length > 0 || draft.playlist_ids.length > 0;
  const readyCount = preview?.ready ?? 0;
  const readyDisplay = preview?.limited ? t("at least {count}", { count: readyCount }) : String(readyCount);
  const saveDisabled = saving || !sourceReady || !draft.name.trim() || (draft.enabled && (previewing || !preview));
  useEffect(() => {
    const requestId = ++previewRequest.current;
    setPreviewError("");
    if (editingId == null || !sourceReady) {
      setPreview(null);
      setPreviewing(false);
      return;
    }
    setPreviewing(true);
    const timer = window.setTimeout(() => {
      api.previewDownloadRule(draft)
        .then((result) => { if (previewRequest.current === requestId) setPreview(result); })
        .catch(() => {
          if (previewRequest.current !== requestId) return;
          setPreview(null);
          setPreviewError(t("The preview could not be calculated. Check the connection and try again."));
        })
        .finally(() => { if (previewRequest.current === requestId) setPreviewing(false); });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [draft, editingId, sourceReady, t]);

  const channelOptions = useMemo(() => options.channels.map((channel) => ({ value: channel.channel_id, label: channel.title || channel.channel_id })), [options.channels]);
  const playlistOptions = useMemo(() => options.playlists.map((playlist) => ({ value: playlist.playlist_id, label: `${playlist.title} · ${playlist.channel_title}` })), [options.playlists]);

  const edit = (rule?: DownloadRule) => {
    setEditingId(rule?.id ?? "new");
    setDraft(rule ? { ...rule } : { ...EMPTY_RULE, name: t("New download rule") });
    setIncludeText(keywordText(rule?.include_keywords ?? []));
    setExcludeText(keywordText(rule?.exclude_keywords ?? []));
    setError("");
  };

  const save = async () => {
    if (!sourceReady || !draft.name.trim()) return;
    setSaving(true);
    setError("");
    try {
      if (editingId === "new") await api.createDownloadRule(draft);
      else if (typeof editingId === "number") await api.updateDownloadRule(editingId, draft);
      setEditingId(null);
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally { setSaving(false); }
  };

  const toggle = async (rule: DownloadRule, enabled: boolean) => {
    setRules((current) => current.map((item) => item.id === rule.id ? { ...item, enabled } : item));
    try { await api.updateDownloadRule(rule.id, { enabled }); } catch { load(); }
  };

  if (!loaded) return <div className="dl-automation-loading" aria-label={t("Loading automation")}><div className="skeleton skeleton-line" /><div className="skeleton skeleton-line short" /></div>;

  if (editingId != null) return (
    <div className="dl-automation-editor">
      <SettingsSection title={editingId === "new" ? t("Create automation") : t("Edit automation")} description={t("Name the rule. You can save it in test mode before allowing automatic downloads.")}>
        <SettingRow label={t("Rule name")} description={t("Use a name that explains the intent, not the implementation.")}>
          <Input id="download-rule-name" aria-label={t("Rule name")} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </SettingRow>
        <SettingRow label={t("Test mode")} description={t("Save the rule and keep its preview available, but do not download anything until you activate it.")}>
          <Switch ariaLabel={t("Test mode")} checked={!draft.enabled} onCheckedChange={(testMode) => setDraft({ ...draft, enabled: !testMode })} />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={t("Sources")} description={t("Choose where this rule may look for videos.")}>
        <OptionPicker
          className="dl-rule-option-picker"
          label={t("Source scope")}
          value={draft.source_mode}
          onChange={(source_mode) => setDraft({ ...draft, source_mode, channel_ids: [], playlist_ids: [] })}
          columns={2}
          options={[
            { value: "selected", label: t("Selected sources"), description: t("Choose specific channels or playlists.") },
            { value: "subscriptions", label: t("All subscriptions"), description: t("Use every subscription, with optional channel exceptions.") },
          ]}
        />
        <SettingRow align="start" label={draft.source_mode === "selected" ? t("Included sources") : t("Exceptions")} description={draft.source_mode === "selected" ? t("At least one channel or playlist is required.") : t("Selected channels will not be downloaded automatically.")}>
          <div className="dl-rule-source-selectors">
            {draft.source_mode === "selected" && <>
              <MultiSelectMenu values={draft.channel_ids} options={channelOptions} onChange={(channel_ids) => setDraft({ ...draft, channel_ids })} label={t("Channels")} searchable floating searchPlaceholder={t("Search channels…")} emptyLabel={t("Choose channels")} summary={(selected) => formatChannelCount(selected.length, language)} />
              <MultiSelectMenu values={draft.playlist_ids} options={playlistOptions} onChange={(playlist_ids) => setDraft({ ...draft, playlist_ids })} label={t("Playlists")} searchable floating searchPlaceholder={t("Search playlists…")} emptyLabel={t("Choose playlists")} summary={(selected) => formatPlaylistCount(selected.length, language)} />
            </>}
            {draft.source_mode === "subscriptions" && <MultiSelectMenu values={draft.channel_ids} options={channelOptions} onChange={(channel_ids) => setDraft({ ...draft, channel_ids })} label={t("Channel exceptions")} searchable floating searchPlaceholder={t("Search channels…")} emptyLabel={t("No exceptions")} summary={(selected) => selected.length === 0 ? t("No exceptions") : t("{p0} excluded", { p0: selected.length })} />}
          </div>
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={t("Matching")} description={t("Required phrases narrow the result. Excluded phrases always win.")}>
        <SettingRow label={t("Search in")} description={t("This area is used for both required and excluded phrases.")}>
          <SelectMenu label={t("Search in")} value={draft.match_field} onChange={(match_field) => setDraft({ ...draft, match_field })} options={[{ value: "title", label: t("Title") }, { value: "description", label: t("Description") }, { value: "both", label: t("Title and description") }]} />
        </SettingRow>
        <SettingRow htmlFor="download-rule-includes" align="start" label={t("Required phrases")} description={t("Leave empty to accept every standard video from the selected sources.")}>
          <div className="dl-rule-control-stack">
            <Textarea id="download-rule-includes" value={includeText} onChange={(event) => { setIncludeText(event.target.value); setDraft({ ...draft, include_keywords: parseKeywords(event.target.value) }); }} placeholder={t("One phrase per line")} />
            {draft.include_keywords.length > 1 && <SegmentedControl label={t("Keyword matching")} value={draft.keyword_mode} onChange={(keyword_mode) => setDraft({ ...draft, keyword_mode })} options={[{ value: "any", label: t("Any phrase") }, { value: "all", label: t("All phrases") }]} />}
          </div>
        </SettingRow>
        <SettingRow htmlFor="download-rule-excludes" align="start" label={t("Always exclude")} description={t("Use simple phrases — no regular expressions required.")}>
          <Textarea id="download-rule-excludes" value={excludeText} onChange={(event) => { setExcludeText(event.target.value); setDraft({ ...draft, exclude_keywords: parseKeywords(event.target.value) }); }} placeholder={t("trailer\nreaction\nspoilers")} />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={t("Video scope")} description={t("Standard videos are always included. Add other types only when you want them too.")}>
        <SettingRow align="start" label={t("Additional types")} description={t("These extend the rule beyond standard videos.")}>
          <div className="dl-rule-checkboxes">
            {shortsEnabled && <Checkbox label="Shorts" description={t("Include Shorts in addition to standard videos.")} checked={draft.include_shorts} onChange={(event) => setDraft({ ...draft, include_shorts: event.target.checked })} />}
            <Checkbox label={t("Members-only videos")} description={t("Include them in addition to standard videos. Requires working YouTube cookies and channel access.")} checked={draft.include_members_only} onChange={(event) => setDraft({ ...draft, include_members_only: event.target.checked })} />
          </div>
        </SettingRow>
        <SettingRow htmlFor="download-rule-min-duration" label={t("Minimum duration")} description={t("0 means no duration limit.")}>
          <InputGroup suffix="min"><Input id="download-rule-min-duration" type="number" min={0} max={1440} value={Math.floor(draft.min_duration_seconds / 60)} onChange={(event) => setDraft({ ...draft, min_duration_seconds: Math.max(0, Number(event.target.value) || 0) * 60 })} /></InputGroup>
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={t("Starting point")} description={t("Choose whether the first run may add older videos to the queue.")}>
        <OptionPicker
          className="dl-rule-option-picker"
          label={t("Starting point")}
          value={draft.backfill_mode}
          onChange={(backfill_mode) => setDraft({ ...draft, backfill_mode })}
          columns={3}
          options={[
            { value: "future", label: t("From now on"), description: t("Only videos uploaded after saving.") },
            { value: "recent", label: t("Recent and future"), description: t("Also include a configurable recent period.") },
            { value: "all", label: t("All known and future"), description: t("May queue the entire known library.") },
          ]}
        />
        {draft.backfill_mode === "recent" && <SettingRow label={t("Look back")} description={t("How far back should the first run search?")} htmlFor="download-rule-lookback"><InputGroup suffix="h"><Input id="download-rule-lookback" type="number" min={1} max={8760} value={draft.lookback_hours} onChange={(event) => setDraft({ ...draft, lookback_hours: Math.max(1, Number(event.target.value) || 1) })} /></InputGroup></SettingRow>}
      </SettingsSection>

      <section className="dl-rule-preview" aria-live="polite">
        <div className="dl-rule-preview-head"><div><strong>{t("Real preview")}</strong><span>{t("Calculated by the same matcher that fills the queue.")}</span></div></div>
        {!sourceReady ? <Alert variant="warning" icon={<AlertTriangle />}>{t("Select at least one source.")}</Alert>
          : previewError ? <Alert variant="danger" icon={<AlertTriangle />}>{previewError}</Alert>
          : !preview ? <div className="dl-rule-preview-loading">{t("Calculating…")}</div>
        : <div className={`dl-rule-preview-content${previewing ? " is-updating" : ""}`}><div className="dl-rule-preview-counts"><span>{t("Matches: {count}", { count: `${preview.limited ? "≥" : ""}${preview.matches}` })}</span><span className="ready"><strong>{preview.limited && "≥"}{preview.ready}</strong>{t(" will enter the queue")}</span><span>{t("Already handled: {count}", { count: preview.existing })}</span></div>{preview.limited && <div className="dl-rule-preview-note">{t("Large result: counts are a safe lower bound and the queue will be filled in batches.")}</div>}{draft.enabled && preview.ready > 0 && <Alert variant="warning" icon={<AlertTriangle />}>{t("Saving will activate the rule and {p0} videos will begin entering the queue.", { p0: readyDisplay })}</Alert>}{preview.sample.length > 0 && <div className="dl-rule-preview-sample">{preview.sample.slice(0, 4).map((video) => <div key={video.video_id}><img src={videoThumbnail(video.thumbnail)} alt="" onError={handleVideoThumbnailError} /><span>{video.title}</span>{video.download_status && <Check />}</div>)}</div>}</div>}
        {sourceReady && !previewError && previewing && preview && <div className="dl-rule-preview-updating">{t("Updating preview…")}</div>}
      </section>
      {error && <Alert variant="danger">{error}</Alert>}
      <FormActions align="between"><Button onClick={() => setEditingId(null)} leadingIcon={<X />}>{t("Cancel")}</Button>{draft.enabled && preview && preview.ready >= 10 ? <Popconfirm message={t("Activate this rule and start queueing {p0} videos?", { p0: readyDisplay })} confirmLabel={t("Activate")} confirmVariant="primary" onConfirm={() => void save()}><Button variant="primary" disabled={saveDisabled} leadingIcon={<Download />}>{saving ? t("Saving…") : t("Save and activate")}</Button></Popconfirm> : <Button variant="primary" disabled={saveDisabled} onClick={save} leadingIcon={<Download />}>{saving ? t("Saving…") : draft.enabled ? t("Save and activate") : t("Save as inactive")}</Button>}</FormActions>
    </div>
  );

  return (
    <div className="dl-automation">
      <div className="dl-automation-intro"><div><h2>{t("Automatic downloads")}</h2><p>{t("Rules are combined with OR: a video is downloaded when any enabled rule matches. Exclusions are local to their rule. An enabled rule may start with a short delay.")}</p></div>{canManage && <Button variant="primary" onClick={() => edit()} leadingIcon={<Plus />}>{t("New rule")}</Button>}</div>
      {!canManage && <Alert variant="info">{t("Automatic downloads are not available for this profile.")}</Alert>}
      {error && <Alert variant="danger">{error}</Alert>}
      {rules.length === 0 ? <EmptyState icon={<Download />} title={t("No automatic downloads")} description={t("Create a rule and preview exactly what it will add to the queue.")} action={canManage ? <Button variant="primary" onClick={() => edit()}>{t("Create first rule")}</Button> : undefined} /> : <div className="dl-rule-list">{rules.map((rule) => {
        const source = rule.source_mode === "subscriptions" ? (rule.channel_ids.length ? t("All subscriptions except {p0}", { p0: rule.channel_ids.length }) : t("All subscriptions")) : `${formatChannelCount(rule.channel_ids.length, language)} · ${formatPlaylistCount(rule.playlist_ids.length, language)}`;
        const condition = rule.include_keywords.length ? t(rule.keyword_mode === "all" ? "All of: {phrases}" : "Any of: {phrases}", { phrases: rule.include_keywords.join(", ") }) : t("Every video");
        return <article key={rule.id} className={`dl-rule-card${rule.enabled ? "" : " is-disabled"}`}><div className="dl-rule-card-main"><div className="dl-rule-card-title"><strong>{rule.name}</strong><Badge size="sm">{rule.backfill_mode === "future" ? t("from now") : rule.backfill_mode === "recent" ? `${rule.lookback_hours} h` : t("all known")}</Badge></div><div className="dl-rule-flow"><span>{source}</span><i>→</i><span>{condition}</span>{rule.exclude_keywords.length > 0 && <><i>→</i><span className="exclude">{t("except")}: {rule.exclude_keywords.join(", ")}</span></>}</div></div>{canManage && <div className="dl-rule-card-actions"><Switch ariaLabel={rule.enabled ? t("Disable {p0}", { p0: rule.name }) : t("Enable {p0}", { p0: rule.name })} checked={rule.enabled} onCheckedChange={(enabled) => void toggle(rule, enabled)} /><IconButton label={t("Edit")} onClick={() => edit(rule)}><Pencil /></IconButton><Popconfirm message={t("Delete “{p0}”?", { p0: rule.name })} onConfirm={() => api.removeDownloadRule(rule.id).then(load)}><IconButton label={t("Delete")}><Trash2 /></IconButton></Popconfirm></div>}</article>;
      })}</div>}
    </div>
  );
}
