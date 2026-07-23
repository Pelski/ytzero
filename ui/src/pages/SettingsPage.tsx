import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import "./SettingsPage.css";
import { createPortal } from "react-dom";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, Camera, Check, CheckCircle2, ChevronDown, ChevronUp, Clock, Download, ExternalLink, Eye, EyeOff, FileText, Filter, FolderUp, GripVertical, Info, KeyRound, ListMinus, LoaderCircle, ListMusic, MonitorPlay, Pencil, Play, Plug, Plus, RefreshCw, RotateCcw, ShieldCheck, Sparkles, Tags, Trash2, Tv, UserMinus, UserPlus, Users, Wrench, X, Zap } from "lucide-react";
import { api, type AppChangelog, type AppLogs, type AppVersion, type Channel, type ChildConfig, type ChildLockStatus, type FilterRule, type FollowedPlaylist, type MembersOnlyVisibility, type PluginManifest, type PluginSettingsResponse, type Profile, type Rule, type Tag, type UpdateCheck, type UserPlaylist, type UserPlaylistRule, type Video, SB_CATEGORIES, PLAYBACK_SPEEDS } from "../api";
import { ProfileAvatar } from "../components/ProfileMenu";
import AuthSettings from "../components/AuthSettings";
import { NAV_ITEMS, normalizeNav, parseNavConfig, type NavConfigEntry } from "../nav";
import { img } from "../img";
import TagChip from "../components/TagChip";
import TagCreateForm from "../components/TagCreateForm";
import TagPickerMenu from "../components/TagPickerMenu";
import ChannelSearchPicker from "../components/ChannelSearchPicker";
import Tooltip from "../components/Tooltip";
import { PlaylistIconPicker } from "../components/PlaylistIcon";
import { TableSkeleton } from "../components/LoadingState";
import Popconfirm from "../components/Popconfirm";
import { emit } from "../events";
import { formatVideoCount, LANGUAGES, languageName, useI18n, type I18nKey } from "../i18n";
import { useDocumentTitle } from "../useDocumentTitle";
import { applyWatchedStyle, parseWatchedStyle, WATCHED_STYLES, type WatchedStyle } from "../watchedStyle";
import { VideoThumbnail, watchProgress } from "../components/VideoThumbnail";
import { applyVideoCardSize, parseVideoCardSize, persistVideoCardSize, VIDEO_CARD_SIZE_MAX, VIDEO_CARD_SIZE_MIN } from "../videoCardSize";
import { Alert, Badge, Button, ButtonAnchor, Chip, ColorPicker, Divider, EmptyState, IconButton, Inline, Input, InputGroup, PageHeader, Popover, SectionHeader, SelectMenu, SettingRow, SettingsSection, Slider, Switch, Tabs, Text, Textarea } from "../components/ui";

type Tab = "channels" | "tags" | "playlists" | "display" | "plugins" | "advanced" | "profiles" | "auth";

// Tabs unavailable to a profile are omitted entirely, not shown as dead ends.
const TABS: { id: Tab; labelKey: I18nKey; icon: React.ReactNode; primaryOnly?: boolean; hiddenForChild?: boolean }[] = [
  { id: "channels", labelKey: "channels", icon: <Tv size={15} /> },
  { id: "tags", labelKey: "tagsRules", icon: <Tags size={15} /> },
  { id: "playlists", labelKey: "playlists", icon: <ListMusic size={15} /> },
  { id: "display", labelKey: "display", icon: <MonitorPlay size={15} />, hiddenForChild: true },
  { id: "plugins", labelKey: "pluginsTab", icon: <Plug size={15} />, hiddenForChild: true },
  { id: "advanced", labelKey: "advanced", icon: <Wrench size={15} />, hiddenForChild: true },
  { id: "profiles", labelKey: "profiles", icon: <Users size={15} />, hiddenForChild: true },
  { id: "auth", labelKey: "authTab", icon: <KeyRound size={15} />, primaryOnly: true, hiddenForChild: true },
];

type LogLevel = "INFO" | "WARN" | "ERROR";

function JsonHighlight({ json }: { json: string }) {
  const tokens = json.match(/"[^"\\]*(?:\\.[^"\\]*)*"(?=\s*:)|"[^"\\]*(?:\\.[^"\\]*)*"|-?\d+(?:\.\d+)?|true|false|null|[{}[\]:,]/g);
  if (!tokens) return <>{json}</>;
  return (
    <>
      {tokens.map((token, i) => {
        const isKey = /^"/.test(token) && tokens[i + 1] === ":";
        const cls =
          isKey ? "json-key" :
          /^"/.test(token) ? "json-string" :
          /^(true|false|null)$/.test(token) ? "json-literal" :
          /^-?\d/.test(token) ? "json-number" :
          "json-punctuation";
        return <span key={`${i}-${token}`} className={cls}>{token}</span>;
      })}
    </>
  );
}

function LogLine({ line }: { line: string }) {
  const match = line.match(/^(\S+)\s+(INFO|WARN|ERROR)\s+([^\s]+)(?:\s+(.*))?$/);
  if (!match) return <div className="log-line log-line--raw">{line}</div>;

  const [, timestamp, level, event, rawMeta] = match as [string, string, LogLevel, string, string | undefined];

  return (
    <div className={`log-line log-line--${level.toLowerCase()}`}>
      <span className="log-time">{timestamp}</span>
      <span className="log-level">{level}</span>
      <span className="log-event">{event}</span>
      {rawMeta ? (
        <span className="log-json"><JsonHighlight json={rawMeta} /></span>
      ) : null}
    </div>
  );
}

function ChangelogNote({ children }: { children: string }) {
  return <>{children.split(/(#\d+)/g).map((part, index) => {
    const issue = part.match(/^#(\d+)$/);
    return issue ? (
      <a className="settings-release-note-link" href={`https://github.com/Pelski/ytzero/issues/${issue[1]}`} target="_blank" rel="noreferrer" key={`${part}-${index}`}>{part}</a>
    ) : part;
  })}</>;
}

function PlaylistSettingsItem({
  playlist,
  rules,
  reload,
  showToast,
}: {
  playlist: UserPlaylist;
  rules: UserPlaylistRule[];
  reload: () => void;
  showToast: (m: string) => void;
}) {
  const { t, language } = useI18n();
  const [name, setName] = useState(playlist.name);
  const [icon, setIcon] = useState(playlist.icon);
  const [pattern, setPattern] = useState("");
  const [matchType, setMatchType] = useState("contains");
  const [field, setField] = useState("title");

  const save = async () => {
    if (!name.trim()) return;
    await api.updateUserPlaylist(playlist.id, { name: name.trim(), icon });
    reload();
  };

  const addRule = async () => {
    if (!pattern.trim()) return;
    const r = await api.addUserPlaylistRule(playlist.id, {
      pattern: pattern.trim(),
      match_type: matchType,
      field,
    });
    showToast(t("ruleAddedExisting", { n: r.matched }));
    setPattern("");
    reload();
  };

  const applyRules = async () => {
    const r = await api.applyUserPlaylistRules(playlist.id);
    showToast(t("rulesApplied", { n: r.matched }));
    reload();
  };

  return (
    <div className="playlist-settings-item">
      <div className="playlist-settings-main">
        <PlaylistIconPicker value={icon} onChange={setIcon} />
        <Input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
        <span className="muted">{formatVideoCount(playlist.video_count, language)}</span>
        <Button onClick={save}>{t("save")}</Button>
        <Popconfirm
          message={t("confirmDelete", { name: playlist.name })}
          onConfirm={() => api.deleteUserPlaylist(playlist.id).then(() => { reload(); emit("playlists-changed"); })}
        >
          <IconButton label={t("deletePlaylist")}>
            <Trash2 />
          </IconButton>
        </Popconfirm>
      </div>
      <div className="playlist-rules">
        <div className="form-row">
          <Input
            type="text"
            placeholder={t("patternPlaceholder")}
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addRule()}
          />
          <SelectMenu label={t("contains")} value={matchType} options={[{ value: "contains", label: t("contains") }, { value: "regex", label: "regex" }]} onChange={setMatchType} />
          <SelectMenu label={t("inTitle")} value={field} options={[{ value: "title", label: t("inTitle") }, { value: "description", label: t("inDescription") }, { value: "both", label: t("titleOrDescription") }]} onChange={setField} />
          <Button variant="primary" onClick={addRule}>
            <Plus /> {t("addRule")}
          </Button>
          <Button onClick={applyRules}>
            <Zap /> {t("applyToDatabase")}
          </Button>
        </div>
        {rules.length > 0 && (
          <table className="list-table">
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td>
                    <code style={{ color: "var(--accent)" }}>{r.pattern}</code>{" "}
                    <span className="muted">
                      ({r.match_type === "regex" ? "regex" : t("contains")},{" "}
                      {r.field === "title" ? t("inTitle") : r.field === "description" ? t("inDescription") : t("titleOrDescription")})
                    </span>
                  </td>
                  <td className="shrink">
                    <IconButton label={t("delete")} onClick={() => api.removeUserPlaylistRule(playlist.id, r.id).then(reload)}>
                      <Trash2 />
                    </IconButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function TagRow({ tag, onSave, onRemove }: { tag: Tag; onSave: (p: { name?: string; color?: string; filter_only?: number }) => Promise<void>; onRemove: () => void }) {
  const { t, language } = useI18n();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState(tag.color);
  const [filterOnly, setFilterOnly] = useState(!!tag.filter_only);

  const save = async () => {
    await onSave({ name, color, filter_only: filterOnly ? 1 : 0 });
    setEditing(false);
  };

  if (editing) {
    return (
      <tr>
        <td>
          <div className="form-row" style={{ margin: 0 }}>
            <ColorPicker label={`${t("edit")} ${tag.name}`} value={color} onChange={setColor} variant="swatch" />
            <Input type="text" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} style={{ flex: 1, minWidth: 0 }} />
          </div>
        </td>
        <td className="muted">{formatVideoCount(tag.video_count ?? 0, language)} · {t("tagChannelCount", { n: tag.channel_count ?? 0 })}</td>
        <td className="shrink">
          <Tooltip text={t("filterOnlyHint")} pos="left">
            <IconButton
              label={t("filterOnlyHint")}
              style={filterOnly ? { color: "var(--accent)" } : { opacity: 0.3 }}
              onClick={() => setFilterOnly(!filterOnly)}
            >
              <Filter size={15} />
            </IconButton>
          </Tooltip>
        </td>
        <td className="shrink">
          <div style={{ display: "flex", gap: 4 }}>
            <IconButton label={t("save")} onClick={save}><Check /></IconButton>
            <IconButton label={t("cancel")} onClick={() => { setName(tag.name); setColor(tag.color); setFilterOnly(!!tag.filter_only); setEditing(false); }}><X /></IconButton>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td><TagChip tag={{ ...tag, name, color }} /></td>
      <td className="muted">{formatVideoCount(tag.video_count ?? 0, language)} · {t("tagChannelCount", { n: tag.channel_count ?? 0 })}</td>
      <td className="shrink">
        <Tooltip text={t("filterOnlyHint")} pos="left">
          <IconButton
            label={t("filterOnlyHint")}
            style={tag.filter_only ? { color: "var(--accent)" } : { opacity: 0.3 }}
            onClick={() => onSave({ filter_only: tag.filter_only ? 0 : 1 })}
          >
            <Filter size={15} />
          </IconButton>
        </Tooltip>
      </td>
      <td className="shrink">
        <div style={{ display: "flex", gap: 4 }}>
          <IconButton label={t("edit")} onClick={() => setEditing(true)}><Pencil /></IconButton>
          <Popconfirm message={t("confirmDelete", { name: tag.name })} onConfirm={onRemove}>
            <IconButton label={t("delete")}><Trash2 /></IconButton>
          </Popconfirm>
        </div>
      </td>
    </tr>
  );
}

function RuleRow({ rule, tags, onSave, onRemove }: { rule: Rule; tags: Tag[]; onSave: (p: { tag_id?: number; pattern?: string; match_type?: string; field?: string }) => Promise<void>; onRemove: () => void }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [pattern, setPattern] = useState(rule.pattern);
  const [matchType, setMatchType] = useState<"contains" | "regex">(rule.match_type as "contains" | "regex");
  const [field, setField] = useState<"title" | "description" | "both">(rule.field as "title" | "description" | "both");
  const [tagId, setTagId] = useState(rule.tag_id);

  const save = async () => {
    await onSave({ pattern, match_type: matchType, field, tag_id: tagId });
    setEditing(false);
  };

  if (editing) {
    return (
      <tr>
        <td colSpan={3}>
          <div className="form-row" style={{ margin: 0, flexWrap: "wrap" }}>
            <Input type="text" value={pattern} onChange={(e) => setPattern(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} style={{ flex: 1, minWidth: 120 }} />
            <SelectMenu label={t("contains")} value={matchType} options={[{ value: "contains", label: t("contains") }, { value: "regex", label: "regex" }]} onChange={setMatchType} />
            <SelectMenu label={t("inTitle")} value={field} options={[{ value: "title", label: t("inTitle") }, { value: "description", label: t("inDescription") }, { value: "both", label: t("titleOrDescription") }]} onChange={setField} />
            <SelectMenu label={t("chooseTag")} value={tagId} options={tags.map((tag) => ({ value: tag.id, label: tag.name }))} onChange={setTagId} searchable searchPlaceholder={t("search")} />
            <IconButton label={t("save")} onClick={save}><Check /></IconButton>
            <IconButton label={t("cancel")} onClick={() => setEditing(false)}><X /></IconButton>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td>
        <span style={{ color: "var(--accent)" }}>{rule.pattern}</span>{" "}
        <span className="muted">({rule.match_type === "regex" ? "regex" : t("contains")}, {rule.field === "title" ? t("inTitle") : rule.field === "description" ? t("inDescription") : t("titleOrDescription")})</span>
      </td>
      <td className="shrink"><TagChip tag={{ id: rule.tag_id, name: rule.tag_name, color: rule.tag_color }} /></td>
      <td className="shrink">
        <div style={{ display: "flex", gap: 4 }}>
          <IconButton label={t("edit")} onClick={() => setEditing(true)}><Pencil /></IconButton>
          <IconButton label={t("delete")} onClick={onRemove}><Trash2 /></IconButton>
        </div>
      </td>
    </tr>
  );
}

/** Chip multiselect for plugin settings storing a comma-separated value list. */
function PluginMultiselect({ value, options, searchPlaceholder, onChange }: {
  value: string;
  options: { value: string; label: string }[];
  searchPlaceholder: string;
  onChange: (next: string) => void;
}) {
  const [query, setQuery] = useState("");
  const selected = useMemo(
    () => new Set(String(value).split(",").map((item) => item.trim()).filter(Boolean)),
    [value],
  );
  const q = query.trim().toLowerCase();
  const visible = options.filter((option) =>
    !q || option.label.toLowerCase().includes(q) || option.value.toLowerCase().includes(q));
  const toggle = (code: string) => {
    const next = new Set(selected);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    onChange(options.filter((option) => next.has(option.value)).map((option) => option.value).join(","));
  };
  return (
    <div className="plugin-multiselect">
      <Input
        type="text"
        className="plugin-text-input"
        placeholder={searchPlaceholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="plugin-multiselect-chips">
        {visible.map((option) => (
          <Chip
            key={option.value}
            type="button"
            active={selected.has(option.value)}
            className={`plugin-term-chip${selected.has(option.value) ? " selected" : ""}`}
            onClick={(e) => { e.preventDefault(); toggle(option.value); }}
          >
            {selected.has(option.value) && <Check size={12} />}
            {option.label}
          </Chip>
        ))}
      </div>
    </div>
  );
}

function DownloadCookiesPanel() {
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [configured, setConfigured] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pastedCookies, setPastedCookies] = useState("");

  useEffect(() => {
    api.downloadCookies().then((result) => setConfigured(result.configured)).catch(() => setError(t("downloadCookiesStatusError")));
  }, [t]);

  const upload = async (file: File) => {
    setUploading(true);
    setError("");
    try {
      const result = await api.uploadDownloadCookies(file);
      setConfigured(result.configured);
      setPastedCookies("");
      setPasteOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("error"));
    } finally {
      setUploading(false);
    }
  };

  const remove = async () => {
    setError("");
    try {
      const result = await api.removeDownloadCookies();
      setConfigured(result.configured);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("error"));
    }
  };

  return (
    <section className="plugin-config-section download-cookies-panel">
      <div className="plugin-config-section-head">
        <h3>{t("downloadCookiesTitle")}</h3>
        <p>{t("downloadCookiesHint")}</p>
      </div>
      <div className="download-cookies-warning">
        <Info size={16} />
        <div>
          <strong>{t("downloadCookiesWarningTitle")}</strong>
          <span>{t("downloadCookiesWarning")} <a href="https://github.com/yt-dlp/yt-dlp/wiki/Extractors" target="_blank" rel="noreferrer">{t("downloadCookiesReadGuide")}</a></span>
        </div>
      </div>
      <div className="download-cookies-actions">
        <span className={`download-cookies-status${configured ? " configured" : ""}`}>{configured ? t("downloadCookiesConfigured") : t("downloadCookiesNotConfigured")}</span>
        <input
          ref={fileInputRef}
          hidden
          type="file"
          accept=".txt,text/plain"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
            event.target.value = "";
          }}
        />
        <Button type="button" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
          <FolderUp size={15} /> {uploading ? t("uploading") : t("downloadCookiesUpload")}
        </Button>
        <Button type="button" disabled={uploading} onClick={() => setPasteOpen((open) => !open)}>
          <FileText size={15} /> {t("downloadCookiesPaste")}
        </Button>
        {configured && <Button variant="danger" type="button" onClick={() => void remove()}><Trash2 size={15} /> {t("downloadCookiesRemove")}</Button>}
      </div>
      {pasteOpen && (
        <div className="download-cookies-paste">
          <Textarea
            autoFocus
            value={pastedCookies}
            placeholder={t("downloadCookiesPastePlaceholder")}
            onChange={(event) => setPastedCookies(event.target.value)}
          />
          <div className="download-cookies-paste-actions">
            <Button variant="primary" type="button" disabled={uploading || !pastedCookies.trim()} onClick={() => void upload(new File([pastedCookies], "cookies.txt", { type: "text/plain" }))}>
              {t("downloadCookiesSave")}
            </Button>
            <Button type="button" disabled={uploading} onClick={() => { setPasteOpen(false); setPastedCookies(""); }}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      )}
      {error && <div className="plugin-config-error">{error}</div>}
    </section>
  );
}

function FilterRuleRow({ rule, channels, onSave, onRemove }: { rule: FilterRule; channels: Channel[]; onSave: (p: Parameters<typeof api.updateFilterRule>[1]) => Promise<void>; onRemove: () => void }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [pattern, setPattern] = useState(rule.pattern);
  const [matchType, setMatchType] = useState<"contains" | "regex">(rule.match_type);
  const [field, setField] = useState<"title" | "description" | "both">(rule.field);
  const [action, setAction] = useState<"reject" | "whitelist">(rule.action);
  const [channelId, setChannelId] = useState(rule.channel_id ?? "");

  const save = async () => {
    await onSave({ pattern, match_type: matchType, field, action, channel_id: channelId || null });
    setEditing(false);
  };

  if (editing) {
    return (
      <tr>
        <td colSpan={4}>
          <div className="form-row" style={{ margin: 0, flexWrap: "wrap" }}>
            <Input type="text" value={pattern} onChange={(e) => setPattern(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} style={{ flex: 1, minWidth: 120 }} />
            <SelectMenu label={t("contains")} value={matchType} options={[{ value: "contains", label: t("contains") }, { value: "regex", label: "regex" }]} onChange={setMatchType} />
            <SelectMenu label={t("inTitle")} value={field} options={[{ value: "title", label: t("inTitle") }, { value: "description", label: t("inDescription") }, { value: "both", label: t("titleOrDescription") }]} onChange={setField} />
            <SelectMenu label={t("rejectMatching")} value={action} options={[{ value: "reject", label: t("rejectMatching") }, { value: "whitelist", label: t("onlyMatching") }]} onChange={setAction} />
            <SelectMenu label={t("allChannels")} value={channelId} options={[{ value: "", label: t("allChannels") }, ...channels.filter((channel) => channel.followed !== 0).map((channel) => ({ value: channel.channel_id, label: channel.title || channel.channel_id }))]} onChange={setChannelId} searchable searchPlaceholder={t("searchChannelPlaceholder")} />
            <IconButton label={t("save")} onClick={save}><Check /></IconButton>
            <IconButton label={t("cancel")} onClick={() => setEditing(false)}><X /></IconButton>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td>
        <span style={{ color: "var(--accent)" }}>{rule.pattern}</span>{" "}
        <span className="muted">({rule.match_type === "regex" ? "regex" : t("contains")}, {rule.field === "title" ? t("inTitle") : rule.field === "description" ? t("inDescription") : t("titleOrDescription")})</span>
      </td>
      <td className="shrink">
        <span className="tag-pill" style={{ color: rule.action === "reject" ? "var(--live)" : "var(--accent)", background: rule.action === "reject" ? "#f2293a18" : "var(--accent)18" }}>
          {rule.action === "reject" ? t("reject") : t("onlyMatching")}
        </span>
      </td>
      <td className="shrink">
        <div style={{ display: "flex", gap: 4 }}>
          <IconButton label={t("edit")} onClick={() => setEditing(true)}><Pencil /></IconButton>
          <Popconfirm message={t("confirmDelete", { name: rule.pattern })} onConfirm={onRemove}>
            <IconButton label={t("delete")}><Trash2 /></IconButton>
          </Popconfirm>
        </div>
      </td>
    </tr>
  );
}

function FilterRuleGroups({ rules, channels, onSave, onRemove }: {
  rules: FilterRule[];
  channels: Channel[];
  onSave: (id: number, patch: Parameters<typeof api.updateFilterRule>[1]) => Promise<void>;
  onRemove: (id: number) => void;
}) {
  const { t } = useI18n();
  const groups = new Map<string, { label: string; rules: FilterRule[] }>();
  for (const r of rules) {
    const key = r.channel_id ?? "__global__";
    if (!groups.has(key)) groups.set(key, { label: r.channel_title ?? t("allChannels"), rules: [] });
    groups.get(key)!.rules.push(r);
  }
  return (
    <>
      {[...groups.entries()].map(([key, group]) => (
        <div key={key} style={{ marginBottom: 16 }}>
          <SectionHeader title={group.label} variant="uppercase" />
          <table className="list-table">
            <tbody>
              {group.rules.map((r) => (
                <FilterRuleRow
                  key={r.id}
                  rule={r}
                  channels={channels}
                  onSave={(patch) => onSave(r.id, patch)}
                  onRemove={() => onRemove(r.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}

function SidebarNavEditor({ value, onChange }: { value: NavConfigEntry[]; onChange: (next: NavConfigEntry[]) => void }) {
  const { t } = useI18n();
  const [dragKey, setDragKey] = useState<string | null>(null);
  const byKey = new Map(NAV_ITEMS.map((i) => [i.to, i] as const));
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const prevTops = useRef<Map<string, number>>(new Map());
  const flipAnims = useRef<Map<string, Animation>>(new Map());

  // FLIP: animate every item from its previous position to the new one whenever
  // the order changes, so reordering and hiding read as smooth motion. The item
  // being dragged is skipped — it already tracks the cursor via the native ghost.
  //
  // Position is read via offsetTop (a layout metric) rather than
  // getBoundingClientRect, which would include the in-flight FLIP transform and
  // feed corrupted positions back in, compounding into jumps on rapid reorders.
  useLayoutEffect(() => {
    itemRefs.current.forEach((el, key) => {
      const prev = prevTops.current.get(key);
      const top = el.offsetTop;
      prevTops.current.set(key, top);
      if (prev === undefined || key === dragKey) return;
      const dy = prev - top;
      if (!dy) return;
      flipAnims.current.get(key)?.cancel();
      flipAnims.current.set(
        key,
        el.animate([{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }], { duration: 180, easing: "cubic-bezier(0.2, 0, 0, 1)" }),
      );
    });
  });

  const move = (from: number, to: number) => {
    if (to < 0 || to >= value.length || from === to) return;
    const next = value.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };

  const toggleHidden = (key: string) =>
    onChange(value.map((v) => (v.key === key ? { ...v, hidden: !v.hidden } : v)));

  const firstHidden = value.findIndex((e) => e.hidden);

  return (
    <div className={`sidebar-order-list${dragKey ? " is-dragging" : ""}`}>
      {value.map((entry, i) => {
        const item = byKey.get(entry.key);
        if (!item) return null;
        const Icon = item.icon;
        return (
          <div key={entry.key} className="sidebar-order-row">
            {i === firstHidden && firstHidden > 0 && (
              <Divider label={t("hiddenItems")} />
            )}
            <div
              ref={(el) => { if (el) itemRefs.current.set(entry.key, el); else itemRefs.current.delete(entry.key); }}
              className={`sidebar-order-item${entry.hidden ? " is-hidden" : ""}${dragKey === entry.key ? " dragging" : ""}`}
              draggable
              onDragStart={(e) => { setDragKey(entry.key); e.dataTransfer.effectAllowed = "move"; }}
              onDragEnd={() => setDragKey(null)}
              onDragOver={(e) => {
                e.preventDefault();
                if (!dragKey || dragKey === entry.key) return;
                const from = value.findIndex((v) => v.key === dragKey);
                if (from === -1 || from === i) return;
                // Only swap once the cursor passes the target's midpoint in the
                // direction of travel — prevents jittery back-and-forth reorders.
                const rect = e.currentTarget.getBoundingClientRect();
                const past = e.clientY - rect.top > rect.height / 2;
                if ((from < i && past) || (from > i && !past)) move(from, i);
              }}
            >
              <span className="sidebar-order-grip" aria-hidden="true"><GripVertical size={16} /></span>
              <Icon size={17} className="sidebar-order-icon" />
              <span className="sidebar-order-name">{t(item.labelKey)}</span>
              <div className="sidebar-order-actions">
                <IconButton label={t("moveUp")} disabled={i === 0} onClick={() => move(i, i - 1)}>
                  <ChevronUp size={15} />
                </IconButton>
                <IconButton label={t("moveDown")} disabled={i === value.length - 1} onClick={() => move(i, i + 1)}>
                  <ChevronDown size={15} />
                </IconButton>
                <IconButton label={entry.hidden ? t("showItem") : t("hideItem")} onClick={() => toggleHidden(entry.key)}>
                  {entry.hidden ? <EyeOff size={15} /> : <Eye size={15} />}
                </IconButton>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const PROFILE_COLORS = ["#f2293a", "#7c5cff", "#3ea6ff", "#00b894", "#e17055", "#fdcb6e", "#e84393", "#636e72"];

function ProfileEditor({ profile, onSaved, onDeleted, showToast, canDelete, allowPin, allowPinReset, allowChildToggle }: {
  profile: Profile;
  onSaved: () => void;
  onDeleted: () => void;
  showToast: (m: string) => void;
  canDelete: boolean;
  allowPin: boolean;
  allowPinReset: boolean;
  allowChildToggle: boolean;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(profile.name);
  const [color, setColor] = useState(profile.avatar_color);
  const [pin, setPin] = useState("");
  const [editingPin, setEditingPin] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deletePin, setDeletePin] = useState("");
  const [deleteError, setDeleteError] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const deleteWithPin = async () => {
    try {
      await api.deleteProfile(profile.id, deletePin);
      onDeleted();
    } catch {
      setDeleteError(true);
    }
  };

  const save = async () => {
    await api.updateProfile(profile.id, { name: name.trim() || profile.name, avatar_color: color });
    showToast(t("profileSaved"));
    onSaved();
  };

  const savePin = async () => {
    if (pin && !/^\d{6}$/.test(pin)) return;
    await api.updateProfile(profile.id, { pin: pin || null });
    setPin("");
    setEditingPin(false);
    showToast(t("profileSaved"));
    onSaved();
  };

  const onAvatarFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await api.uploadProfileAvatar(profile.id, file);
    showToast(t("profileSaved"));
    onSaved();
  };

  return (
    <div className="profile-edit-grid">
      <div className="profile-edit-top">
        {/* Avatar: hover to change (opens file picker), corner button to remove. */}
        <div className="profile-avatar-editable" onClick={() => fileRef.current?.click()} title={t("changeAvatar")}>
          <ProfileAvatar profile={{ name, avatar: profile.avatar, avatar_color: color }} size={76} />
          <div className="profile-avatar-overlay"><Camera size={22} /></div>
          {profile.avatar && (
            <div className="profile-avatar-remove" onClick={(e) => e.stopPropagation()}>
              <Popconfirm message={t("removeAvatarConfirm")} onConfirm={async () => { await api.removeProfileAvatar(profile.id); onSaved(); }}>
                <IconButton className="profile-avatar-remove-btn" label={t("removeAvatar")}><X size={13} /></IconButton>
              </Popconfirm>
            </div>
          )}
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={onAvatarFile} />
        </div>

        <div className="profile-name-field">
          <label className="switch-label">{t("profileName")}</label>
          <Input value={name} placeholder={t("profileName")} onChange={(e) => setName(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === "Enter" && save()} />
        </div>
      </div>

      {/* Color is only the fallback background for the initials — hide it once a
          photo is set. */}
      {!profile.avatar && (
        <div className="profile-color-section">
          <label className="switch-label">{t("avatarColorLabel")}</label>
          <div className="profile-color-swatches">
            {PROFILE_COLORS.map((c) => (
              <button
                key={c}
                className={`profile-color-swatch${c === color ? " selected" : ""}`}
                style={{ background: c }}
                aria-label={c}
                onClick={() => { setColor(c); api.updateProfile(profile.id, { avatar_color: c }).then(onSaved); }}
              />
            ))}
          </div>
        </div>
      )}

      {allowPin && (
        <div className="profile-edit-row">
          {editingPin ? (
            <>
              <Input
                type="password"
                inputMode="numeric"
                maxLength={6}
                placeholder={t("pinPlaceholder")}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              />
              <Button variant="primary" onClick={savePin} disabled={pin.length > 0 && pin.length !== 6}>{t("save")}</Button>
              <Button onClick={() => { setEditingPin(false); setPin(""); }}>{t("cancel")}</Button>
            </>
          ) : profile.has_pin ? (
            <>
              <span className="profile-card-meta">{t("profilePin")}: ••••••</span>
              <Button onClick={() => setEditingPin(true)}>{t("changePin")}</Button>
              <Button onClick={async () => { await api.updateProfile(profile.id, { pin: null }); onSaved(); }}>{t("removePin")}</Button>
            </>
          ) : (
            <Button onClick={() => setEditingPin(true)}>{t("setPin")}</Button>
          )}
        </div>
      )}

      {/* Child-profile flag: primary-only, and never on the primary itself. */}
      {allowChildToggle && (
        <Switch
            label={t("childProfile")}
            description={t("childProfileHint")}
            checked={profile.is_child}
            onCheckedChange={async (next) => {
              await api.updateProfile(profile.id, { is_child: next });
              showToast(t("profileSaved"));
              onSaved();
            }}
          />
      )}

      {allowChildToggle && profile.is_child && (
        <ChildProfileSettings profile={profile} onSaved={onSaved} showToast={showToast} />
      )}

      {/* Primary can clear (but not set) another profile's forgotten PIN. */}
      {allowPinReset && profile.has_pin && (
        <div className="profile-edit-row">
          <span className="profile-card-meta">{t("profilePin")}: ••••••</span>
          <Popconfirm message={t("resetPinConfirm")} onConfirm={async () => { await api.resetProfilePin(profile.id); showToast(t("profileSaved")); onSaved(); }}>
            <Button>{t("resetPin")}</Button>
          </Popconfirm>
        </div>
      )}

      {canDelete && (
        <div className="profile-edit-row">
          {!profile.has_pin ? (
            <Popconfirm message={t("deleteProfileConfirm")} onConfirm={async () => { await api.deleteProfile(profile.id); onDeleted(); }}>
              <Button variant="danger"><Trash2 size={15} /> {t("deleteProfile")}</Button>
            </Popconfirm>
          ) : !profile.active ? (
            // PIN-protected: must be logged into it to delete.
            <span className="profile-card-meta">{t("switchToDeleteHint")}</span>
          ) : confirmingDelete ? (
            <>
              <Input
                type="password"
                inputMode="numeric"
                maxLength={6}
                autoFocus
                className={`form-input${deleteError ? " input-error" : ""}`}
                placeholder={t("pinPlaceholder")}
                value={deletePin}
                onChange={(e) => { setDeletePin(e.target.value.replace(/\D/g, "").slice(0, 6)); setDeleteError(false); }}
                onKeyDown={(e) => e.key === "Enter" && deletePin.length === 6 && deleteWithPin()}
              />
              <Button variant="danger" onClick={deleteWithPin} disabled={deletePin.length !== 6}>{t("deleteProfile")}</Button>
              <Button onClick={() => { setConfirmingDelete(false); setDeletePin(""); setDeleteError(false); }}>{t("cancel")}</Button>
            </>
          ) : (
            <Button variant="danger" onClick={() => setConfirmingDelete(true)}><Trash2 size={15} /> {t("deleteProfile")}</Button>
          )}
        </div>
      )}
    </div>
  );
}

// Child-profile limits & restrictions (primary-only). Stored via PATCH
// /profiles/:id { child_config }, so a child can't edit them through /settings.
function ChildProfileSettings({ profile, onSaved, showToast }: {
  profile: Profile;
  onSaved: () => void;
  showToast: (m: string) => void;
}) {
  const { t } = useI18n();
  const cfg = profile.child_config ?? { limit_minutes: 0, local_only: true, hide_shorts: false, hide_live: false, downloads_only: false };
  const [minutes, setMinutes] = useState(cfg.limit_minutes > 0 ? String(cfg.limit_minutes) : "60");
  const [childLockEnabled, setChildLockEnabled] = useState(true);

  useEffect(() => {
    api.childLock().then((r) => setChildLockEnabled(r.child_lock.enabled)).catch(() => {});
  }, []);

  const save = async (child_config: Partial<ChildConfig>) => {
    await api.updateProfile(profile.id, { child_config });
    showToast(t("profileSaved"));
    onSaved();
  };

  const saveMinutes = () => {
    const n = Math.max(5, Math.min(24 * 60, parseInt(minutes, 10) || 0));
    setMinutes(String(n));
    if (n !== cfg.limit_minutes) save({ limit_minutes: n });
  };

  return (
    <>
      <Switch label={t("childLimit")} description={t("childLimitHint")} checked={cfg.limit_minutes > 0} onCheckedChange={(next) => save({ limit_minutes: next ? parseInt(minutes, 10) || 60 : 0 })} />
      {cfg.limit_minutes > 0 && (
        <div className="profile-edit-row">
          <label className="switch-label" style={{ margin: 0 }}>{t("childLimitMinutes")}</label>
          <Input
            style={{ width: 90 }}
            type="number"
            min={5}
            max={1440}
            step={5}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            onBlur={saveMinutes}
            onKeyDown={(e) => e.key === "Enter" && saveMinutes()}
          />
        </div>
      )}

      <Switch label={t("childLocalOnly")} description={t("childLocalOnlyHint")} checked={cfg.local_only} onCheckedChange={(next) => save({ local_only: next })} />

      <Switch label={t("childHideShorts")} description={t("childHideShortsHint")} checked={cfg.hide_shorts} onCheckedChange={(next) => save({ hide_shorts: next })} />

      <Switch label={t("childHideLive")} description={t("childHideLiveHint")} checked={cfg.hide_live} onCheckedChange={(next) => save({ hide_live: next })} />

      <Switch label={t("childDownloadsOnly")} description={t("childDownloadsOnlyHint")} checked={cfg.downloads_only} onCheckedChange={(next) => save({ downloads_only: next })} />

      {!childLockEnabled && <Alert variant="warning">{t("childPinWarning")}</Alert>}

      {profile.pin_locked && (
        <div className="profile-edit-row">
          <span className="profile-card-meta">{t("childPinLockedInfo")}</span>
          <Button
            onClick={async () => {
              await api.unlockChildProfile(profile.id);
              showToast(t("profileSaved"));
              onSaved();
            }}
          >{t("childUnlockProfile")}</Button>
        </div>
      )}
    </>
  );
}

function ProfilesSettings({ showToast }: { showToast: (m: string) => void }) {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(PROFILE_COLORS[1]);

  // Reload the list and tell the topbar picker to refresh too.
  const refresh = useCallback(() => {
    api.profiles().then((r) => setProfiles(r.profiles)).catch(() => {});
    emit("profiles-changed");
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  // Opened from the topbar "Add profile" action.
  useEffect(() => {
    if (searchParams.get("new") === "1") {
      setCreating(true);
      searchParams.delete("new");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const create = async () => {
    if (!newName.trim()) return;
    await api.createProfile({ name: newName.trim(), avatar_color: newColor });
    setNewName("");
    setNewColor(PROFILE_COLORS[1]);
    setCreating(false);
    refresh();
  };

  // The primary profile may edit others (name/color/avatar); everyone else can
  // only edit their own. PIN and deletion stay owner-only.
  const iAmPrimary = profiles.find((p) => p.active)?.is_primary ?? false;

  return (
    <SettingsSection>
      <Text tone="secondary" className="settings-block-hint">{t("profilesHint")}</Text>
      <div className="profiles-list">
        {profiles.map((p) => {
          const canEdit = p.active || iAmPrimary;
          return (
          <div key={p.id} className={`profile-card${p.active ? " active" : ""}`}>
            <ProfileAvatar profile={p} size={44} />
            <div className="profile-card-main">
              <div className="profile-card-name">
                {p.name}
                {p.active && <Check size={15} style={{ color: "var(--accent)" }} />}
              </div>
              <div className="profile-card-meta">
                {[
                  p.is_primary && t("primaryProfile"),
                  p.is_child && t("childProfile"),
                  p.has_pin && t("profilePin") + " ••••••",
                ].filter(Boolean).join(" · ") || "—"}
              </div>
            </div>
            {canEdit && (
              <div className="profile-card-actions">
                <Button onClick={() => setExpanded(expanded === p.id ? null : p.id)}>
                  <Pencil size={15} /> {t("edit")}
                </Button>
              </div>
            )}
            {canEdit && expanded === p.id && (
              <div style={{ flexBasis: "100%", marginTop: 12 }}>
                <ProfileEditor
                  profile={p}
                  showToast={showToast}
                  allowPin={p.active}
                  allowPinReset={iAmPrimary && !p.active}
                  allowChildToggle={iAmPrimary && !p.is_primary}
                  canDelete={profiles.length > 1 && p.active && !p.is_primary}
                  onSaved={refresh}
                  onDeleted={() => { setExpanded(null); refresh(); }}
                />
              </div>
            )}
          </div>
          );
        })}
      </div>

      {creating ? (
        <div className="profile-card">
          <ProfileAvatar profile={{ name: newName || "?", avatar: "", avatar_color: newColor }} size={44} />
          <div className="profile-card-main">
            <Input value={newName} placeholder={t("profileName")} autoFocus onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
            <div className="profile-color-swatches" style={{ marginTop: 8 }}>
              {PROFILE_COLORS.map((c) => (
                <button key={c} className={`profile-color-swatch${c === newColor ? " selected" : ""}`} style={{ background: c }} aria-label={c} onClick={() => setNewColor(c)} />
              ))}
            </div>
          </div>
          <div className="profile-card-actions">
            <Button variant="primary" onClick={create} disabled={!newName.trim()}>{t("create")}</Button>
            <Button onClick={() => setCreating(false)}>{t("cancel")}</Button>
          </div>
        </div>
      ) : (
        <Button onClick={() => setCreating(true)}><UserPlus size={15} /> {t("addProfile")}</Button>
      )}
    </SettingsSection>
  );
}

// Admin-only: claim every existing channel for one profile (ownership migration
// for installs that had channels before auth). See POST /channels/assign-all.
function ChannelOwnership({ showToast }: { showToast: (m: string) => void }) {
  const { t } = useI18n();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [target, setTarget] = useState<number | "">("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.profiles().then((r) => setProfiles(r.profiles)).catch(() => {});
  }, []);

  const assign = async () => {
    if (typeof target !== "number") return;
    setBusy(true);
    try {
      const r = await api.assignAllChannels(target);
      showToast(t("assignChannelsDone", { count: r.added }));
    } catch (e: any) {
      showToast(e?.message ?? t("loginError"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSection title={t("assignChannelsTitle")}>
      <Text tone="secondary">{t("assignChannelsHint")}</Text>
      <div className="form-row">
        <SelectMenu label={t("assignChannelsSelect")} value={target} options={[{ value: "" as const, label: t("assignChannelsSelect") }, ...profiles.map((profile) => ({ value: profile.id, label: profile.name }))]} onChange={setTarget} />
        <Button variant="primary" disabled={typeof target !== "number" || busy} onClick={assign}>
          {busy ? <LoaderCircle size={15} className="spin" /> : <Tv size={15} />}
          {t("assignChannelsButton")}
        </Button>
      </div>
    </SettingsSection>
  );
}

export default function SettingsPage({ showToast }: { showToast: (m: string) => void }) {
  const { t, language, setLanguage, locale } = useI18n();
  useDocumentTitle(t("settingsTitle"));
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const tab: Tab = TABS.some((item) => item.id === requestedTab) ? requestedTab as Tab : "channels";
  const section = searchParams.get("section");
  const channelSubTab: "list" | "playlists" | "filters" = section === "filters" || section === "playlists" ? section : "list";
  const tagSubTab: "list" | "rules" = section === "rules" ? "rules" : "list";
  const advancedSubTab: "external" | "logs" | "changelog" = section === "logs" || section === "changelog" ? section : "external";
  const setSettingsRoute = (nextTab: Tab, nextSection?: string) => {
    const next = new URLSearchParams();
    next.set("tab", nextTab);
    if (nextSection) next.set("section", nextSection);
    setSearchParams(next, { replace: true });
  };
  const setTab = (nextTab: Tab) => setSettingsRoute(nextTab);
  const setChannelSubTab = (nextSection: "list" | "playlists" | "filters") => setSettingsRoute("channels", nextSection === "list" ? undefined : nextSection);
  const setTagSubTab = (nextSection: "list" | "rules") => setSettingsRoute("tags", nextSection === "list" ? undefined : nextSection);
  const setAdvancedSubTab = (nextSection: "external" | "logs" | "changelog") => setSettingsRoute("advanced", nextSection === "external" ? undefined : nextSection);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [filterRules, setFilterRules] = useState<FilterRule[]>([]);
  const [playlists, setPlaylists] = useState<UserPlaylist[]>([]);
  const [followedPlaylists, setFollowedPlaylists] = useState<FollowedPlaylist[]>([]);
  const [playlistRules, setPlaylistRules] = useState<Record<number, UserPlaylistRule[]>>({});
  const [plugins, setPlugins] = useState<PluginManifest[]>([]);
  const [pluginSettings, setPluginSettings] = useState<Record<string, PluginSettingsResponse>>({});
  const [pluginSettingsModalId, setPluginSettingsModalId] = useState<string | null>(null);
  const [resettingPluginId, setResettingPluginId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [addingChannel, setAddingChannel] = useState(false);
  const [addingTag, setAddingTag] = useState(false);
  const [externalVideos, setExternalVideos] = useState<Video[]>([]);
  const [loadingExternal, setLoadingExternal] = useState(false);
  const [clearingExternal, setClearingExternal] = useState(false);
  const [logs, setLogs] = useState<AppLogs | null>(null);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [appVersion, setAppVersion] = useState<AppVersion | null>(null);
  const [changelog, setChangelog] = useState<AppChangelog | null>(null);
  const [updateCheck, setUpdateCheck] = useState<UpdateCheck | null>(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updateCheckError, setUpdateCheckError] = useState(false);
  const [updateCheckInterval, setUpdateCheckInterval] = useState("off");

  const [channelUrl, setChannelUrl] = useState("");
  const [channelCustomName, setChannelCustomName] = useState("");
  const [renamingChannelId, setRenamingChannelId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [channelQuery, setChannelQuery] = useState("");
  const [tagName, setTagName] = useState("");
  const [tagColor, setTagColor] = useState("#3ea6ff");
  const [rulePattern, setRulePattern] = useState("");
  const [ruleTag, setRuleTag] = useState<number | "">("");
  const [ruleMatch, setRuleMatch] = useState("contains");
  const [ruleField, setRuleField] = useState("title");
  const [filterPattern, setFilterPattern] = useState("");
  const [filterMatch, setFilterMatch] = useState("contains");
  const [filterField, setFilterField] = useState("title");
  const [filterAction, setFilterAction] = useState("reject");
  const [filterChannel, setFilterChannel] = useState("");
  const [playlistName, setPlaylistName] = useState("");
  const [playlistIcon, setPlaylistIcon] = useState("ListMusic");
  const [appName, setAppName] = useState("YT Zero");
  const [appNameInput, setAppNameInput] = useState("YT Zero");
  const [appIconColor, setAppIconColor] = useState("#0a5fff");
  // App-wide settings (app name, icon color, child lock) are owned by the
  // primary profile; other profiles see them read-only.
  const [isPrimary, setIsPrimary] = useState(true);
  const [isChildProfile, setIsChildProfile] = useState<boolean | null>(null);
  const [showShorts, setShowShorts] = useState(false);
  const [showTopChannels, setShowTopChannels] = useState(true);
  const [hideLiveFromFeed, setHideLiveFromFeed] = useState(false);
  const [membersOnlyVisibility, setMembersOnlyVisibility] = useState<MembersOnlyVisibility>("everywhere");
  const [watchedStyle, setWatchedStyle] = useState<WatchedStyle>("dimmed");
  const [videoCardSize, setVideoCardSize] = useState(248);
  const [navConfig, setNavConfig] = useState<NavConfigEntry[]>(() => parseNavConfig(null));
  const navSaveTimer = useRef<number | null>(null);
  const [playerHl, setPlayerHl] = useState("pl");
  const [playerCc, setPlayerCc] = useState(false);
  const [subSize, setSubSize] = useState(19);
  const [subColor, setSubColor] = useState("#ffffff");
  const [subBg, setSubBg] = useState(75);
  const [playerQuality, setPlayerQuality] = useState("auto");
  const [playerSpeed, setPlayerSpeed] = useState("1");
  const [keyboardSeekSeconds, setKeyboardSeekSeconds] = useState("5");
  const [autoFullscreen, setAutoFullscreen] = useState(false);
  const [sbEnabled, setSbEnabled] = useState(false);
  const [sbCategories, setSbCategories] = useState<string[]>(["sponsor"]);
  const [childLock, setChildLock] = useState<ChildLockStatus>({ enabled: false, locked: false });
  const [unlockPin, setUnlockPin] = useState("");
  const [enablePin, setEnablePin] = useState("");
  const [enablePinConfirm, setEnablePinConfirm] = useState("");
  const [newPin, setNewPin] = useState("");
  const [newPinConfirm, setNewPinConfirm] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const [tagMenuChannelId, setTagMenuChannelId] = useState<string | null>(null);
  const [newChannelTagName, setNewChannelTagName] = useState("");
  const [newChannelTagColor, setNewChannelTagColor] = useState("#3ea6ff");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ch, tg, rl, fr, pl] = await Promise.all([api.channels(), api.tags(), api.rules(), api.filterRules(), api.userPlaylists()]);
      setChannels(ch.channels);
      setTags(tg.tags);
      setRules(rl.rules);
      setFilterRules(fr.rules);
      setPlaylists(pl.playlists);
      const rulePairs = await Promise.all(pl.playlists.map(async (p) => [p.id, (await api.userPlaylistRules(p.id)).rules] as const));
      setPlaylistRules(Object.fromEntries(rulePairs));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadExternal = useCallback(() => {
    setLoadingExternal(true);
    api.externalVideos()
      .then((r) => setExternalVideos(r.videos))
      .catch(console.error)
      .finally(() => setLoadingExternal(false));
  }, []);

  const loadLogs = useCallback(() => {
    setLoadingLogs(true);
    api.logs()
      .then(setLogs)
      .catch(console.error)
      .finally(() => setLoadingLogs(false));
  }, []);

  const loadChangelog = useCallback(() => {
    Promise.all([api.version(), api.changelog()])
      .then(([version, bundledChangelog]) => {
        setAppVersion(version);
        setChangelog(bundledChangelog);
      })
      .catch(console.error);
  }, []);

  const checkForUpdates = async () => {
    setCheckingUpdates(true);
    setUpdateCheckError(false);
    try {
      setUpdateCheck(await api.checkUpdates());
    } catch {
      setUpdateCheckError(true);
    } finally {
      setCheckingUpdates(false);
    }
  };

  const loadPlugins = useCallback(() => {
    api.plugins()
      .then(async (r) => {
        setPlugins(r.plugins);
        const pairs = await Promise.all(r.plugins.map(async (plugin) => [plugin.id, await api.pluginSettings(plugin.id)] as const));
        setPluginSettings(Object.fromEntries(pairs));
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (tab === "advanced" && advancedSubTab === "external") loadExternal();
    if (tab === "advanced" && advancedSubTab === "logs") loadLogs();
    if (tab === "advanced" && advancedSubTab === "changelog") loadChangelog();
  }, [tab, advancedSubTab, loadExternal, loadLogs, loadChangelog]);

  const loadFollowedPlaylists = useCallback(() => {
    api.followedPlaylists().then((result) => setFollowedPlaylists(result.playlists)).catch(console.error);
  }, []);

  useEffect(() => {
    if (tab === "channels" && channelSubTab === "playlists") loadFollowedPlaylists();
  }, [tab, channelSubTab, loadFollowedPlaylists]);

  const clearExternal = async () => {
    setClearingExternal(true);
    try {
      const r = await api.clearExternal();
      showToast(t("externalCleared").replace("{n}", String(r.deleted)));
      loadExternal();
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      setClearingExternal(false);
    }
  };

  const removeExternal = async (videoId: string) => {
    setExternalVideos((vs) => vs.filter((v) => v.video_id !== videoId));
    try {
      await api.removeExternal(videoId);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
      loadExternal();
    }
  };

  const removeExternalChannel = async (channelId: string) => {
    const ids = externalVideos.filter((v) => v.channel_id === channelId).map((v) => v.video_id);
    setExternalVideos((vs) => vs.filter((v) => v.channel_id !== channelId));
    try {
      await Promise.all(ids.map((id) => api.removeExternal(id)));
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
      loadExternal();
    }
  };

  const followExternalChannel = async (channelId: string) => {
    setExternalVideos((vs) => vs.filter((v) => v.channel_id !== channelId));
    try {
      await api.followChannel(channelId, true);
      emit("channels-changed");
      load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
      loadExternal();
    }
  };

  useEffect(() => {
    // "Admin" = primary profile OR an OIDC session in the configured admin group.
    // is_admin drives the admin-only tabs/sections (kept in the isPrimary var).
    api.authStatus().then((s) => setIsPrimary(!!s.is_admin)).catch(() => {});
    api.childStatus().then((s) => setIsChildProfile(s.is_child)).catch(() => setIsChildProfile(false));
    load().catch(console.error);
    loadPlugins();
    Promise.all([api.settings(), api.childLock()])
      .then(([r, cl]) => {
        const name = r.settings.app_name || "YT Zero";
        setAppName(name);
        setAppNameInput(name);
        setAppIconColor(r.settings.app_icon_color || "#0a5fff");
        setUpdateCheckInterval(r.settings.update_check_interval || "off");
        setShowShorts(r.settings.show_shorts === "1");
        setShowTopChannels(r.settings.show_top_channels !== "0");
        setHideLiveFromFeed(r.settings.hide_live_from_feed === "1");
        setMembersOnlyVisibility(
          r.settings.hide_members_only_from_feed === "1"
            ? r.settings.hide_members_only_on_channel === "1" ? "hidden" : "channel"
            : "everywhere"
        );
        setWatchedStyle(parseWatchedStyle(r.settings.watched_style));
        setVideoCardSize(parseVideoCardSize(r.settings.grid_size));
        const raw = r.settings.sidebar_nav;
        const navCfg = parseNavConfig(raw);
        if (!raw && r.settings.shorts_tab === "1") {
          const entry = navCfg.find((e) => e.key === "/shorts");
          if (entry) entry.hidden = false;
        }
        setNavConfig(normalizeNav(navCfg));
        setPlayerHl(r.settings.player_hl);
        setPlayerCc(r.settings.player_cc === "1");
        const rawSubSize = r.settings.player_sub_size;
        const legacySubSize = rawSubSize === "small" ? 14 : rawSubSize === "large" ? 26 : rawSubSize === "medium" ? 19 : Number(rawSubSize);
        setSubSize(Number.isFinite(legacySubSize) ? Math.min(48, Math.max(12, legacySubSize)) : 19);
        setSubColor(r.settings.player_sub_color || "#ffffff");
        setSubBg(Number.isFinite(Number(r.settings.player_sub_bg)) ? Number(r.settings.player_sub_bg) : 75);
        setPlayerQuality(r.settings.player_quality);
        setPlayerSpeed(r.settings.player_speed ?? "1");
        setKeyboardSeekSeconds(r.settings.keyboard_seek_seconds ?? "5");
        setAutoFullscreen(r.settings.auto_fullscreen_landscape === "1");
        setSbEnabled(r.settings.sponsorblock_enabled === "1");
        try { setSbCategories(JSON.parse(r.settings.sponsorblock_categories || '["sponsor"]')); } catch {}
        setChildLock(cl.child_lock);
      })
      .catch(console.error);
  }, [load, loadPlugins]);

  const togglePlugin = async (plugin: PluginManifest) => {
    const enabled = !plugin.enabled;
    setPlugins((current) => current.map((p) => p.id === plugin.id ? { ...p, enabled } : p));
    try {
      const r = await api.updatePlugin(plugin.id, enabled);
      setPlugins(r.plugins);
      emit("plugins-changed");
      showToast(enabled ? t("pluginEnabled") : t("pluginDisabled"));
    } catch (e) {
      loadPlugins();
      showToast(e instanceof Error ? e.message : String(e));
    }
  };

  const updatePluginSetting = async (pluginId: string, key: string, value: number | string) => {
    setPluginSettings((current) => {
      const currentPlugin = current[pluginId];
      if (!currentPlugin) return current;
      return {
        ...current,
        [pluginId]: {
          ...currentPlugin,
          settings: { ...currentPlugin.settings, [key]: value },
        },
      };
    });
    try {
      const next = await api.updatePluginSettings(pluginId, { [key]: value });
      setPluginSettings((current) => ({ ...current, [pluginId]: next }));
      emit("plugins-changed");
    } catch (e) {
      loadPlugins();
      showToast(e instanceof Error ? e.message : String(e));
    }
  };

  const updatePluginBlockedTerms = async (pluginId: string, blockedTerms: string[]) => {
    setPluginSettings((current) => {
      const currentPlugin = current[pluginId];
      if (!currentPlugin) return current;
      return {
        ...current,
        [pluginId]: {
          ...currentPlugin,
          terms: {
            lastTerms: currentPlugin.terms?.lastTerms ?? [],
            blockedTerms,
          },
        },
      };
    });
    try {
      const next = await api.updatePluginSettings(pluginId, { blockedTerms });
      setPluginSettings((current) => ({ ...current, [pluginId]: next }));
    } catch (e) {
      loadPlugins();
      showToast(e instanceof Error ? e.message : String(e));
    }
  };

  const resetPlugin = async (pluginId: string) => {
    setResettingPluginId(pluginId);
    try {
      const next = await api.resetPlugin(pluginId);
      setPluginSettings((current) => ({ ...current, [pluginId]: next }));
      emit("plugins-changed");
      showToast(t("pluginResetDone"));
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      setResettingPluginId(null);
    }
  };

  useEffect(() => {
    if (!pluginSettingsModalId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPluginSettingsModalId(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pluginSettingsModalId]);

  const toggleShorts = async () => {
    const next = !showShorts;
    setShowShorts(next);
    await api.updateSettings({ show_shorts: next ? "1" : "0" });
    showToast(next ? t("shortsVisible") : t("shortsHidden"));
  };

  const toggleTopChannels = async () => {
    const next = !showTopChannels;
    setShowTopChannels(next);
    await api.updateSettings({ show_top_channels: next ? "1" : "0" });
    emit("top-channels-changed");
    showToast(t("displaySettingsSaved"));
  };

  const toggleLiveFromFeed = async () => {
    const next = !hideLiveFromFeed;
    setHideLiveFromFeed(next);
    await api.updateSettings({ hide_live_from_feed: next ? "1" : "0" });
    showToast(t("displaySettingsSaved"));
  };

  const changeMembersOnlyVisibility = async (next: MembersOnlyVisibility) => {
    const previous = membersOnlyVisibility;
    setMembersOnlyVisibility(next);
    const values = {
      everywhere: ["0", "0"],
      channel: ["1", "0"],
      hidden: ["1", "1"],
      default: ["0", "0"],
    } as const;
    const [hideFromFeed, hideOnChannel] = values[next];
    try {
      await api.updateSettings({ hide_members_only_from_feed: hideFromFeed, hide_members_only_on_channel: hideOnChannel });
      showToast(t("displaySettingsSaved"));
    } catch (error) {
      setMembersOnlyVisibility(previous);
      showToast(error instanceof Error ? error.message : t("error"));
    }
  };

  const changeWatchedStyle = async (next: WatchedStyle) => {
    setWatchedStyle(next);
    applyWatchedStyle(next);
    await api.updateSettings({ watched_style: next });
    emit("watched-style-changed");
    showToast(t("displaySettingsSaved"));
  };

  const changeVideoCardSize = (next: number) => {
    setVideoCardSize(next);
    persistVideoCardSize(next);
    applyVideoCardSize(next);
    emit("video-card-size-changed");
  };

  // Reorder/hide is interactive (drag fires many updates) — reflect locally at
  // once, then persist on a short debounce and notify the sidebar to re-read.
  const persistNavConfig = (next: NavConfigEntry[]) => {
    const normalized = normalizeNav(next);
    setNavConfig(normalized);
    if (navSaveTimer.current) window.clearTimeout(navSaveTimer.current);
    navSaveTimer.current = window.setTimeout(() => {
      api.updateSettings({ sidebar_nav: JSON.stringify(normalized) })
        .then(() => { emit("sidebar-nav-changed"); showToast(t("displaySettingsSaved")); })
        .catch(console.error);
    }, 400);
  };

  const resetNavConfig = () => persistNavConfig(parseNavConfig(null));

  const saveAppName = async () => {
    const name = appNameInput.trim() || "YT Zero";
    setAppName(name);
    setAppNameInput(name);
    await api.updateSettings({ app_name: name });
    emit("app-name-changed");
    showToast(t("appNameSaved"));
  };

  const saveAppIconColor = async (color: string) => {
    setAppIconColor(color);
    await api.updateSettings({ app_icon_color: color });
    emit("app-name-changed");
    showToast(t("appIconColorSaved"));
  };

  const savePlayer = async (patch: Record<string, string>) => {
    await api.updateSettings(patch);
    showToast(t("playerSettingsSaved"));
  };

  const toggleSb = async () => {
    const next = !sbEnabled;
    setSbEnabled(next);
    await api.updateSettings({ sponsorblock_enabled: next ? "1" : "0" });
    showToast(t("sponsorblockSaved"));
  };

  const toggleSbCategory = async (id: string) => {
    const next = sbCategories.includes(id)
      ? sbCategories.filter((c) => c !== id)
      : [...sbCategories, id];
    setSbCategories(next);
    await api.updateSettings({ sponsorblock_categories: JSON.stringify(next) });
    showToast(t("sponsorblockSaved"));
  };

  const showPinError = () => showToast(t("pinMustBeSixDigits"));
  const isValidPin = (pin: string) => /^\d{6}$/.test(pin);

  const unlockSettings = async () => {
    if (!isValidPin(unlockPin)) return showPinError();
    try {
      const r = await api.unlockChildLock(unlockPin);
      setChildLock(r.child_lock);
      setUnlockPin("");
      showToast(t("settingsUnlocked"));
    } catch {
      showToast(t("pinInvalid"));
    }
  };

  const enableChildLock = async () => {
    if (!isValidPin(enablePin) || enablePin !== enablePinConfirm) {
      showToast(enablePin !== enablePinConfirm ? t("pinsDoNotMatch") : t("pinMustBeSixDigits"));
      return;
    }
    const r = await api.enableChildLock(enablePin);
    setChildLock(r.child_lock);
    setEnablePin("");
    setEnablePinConfirm("");
    showToast(t("childLockEnabled"));
  };

  const changeChildPin = async () => {
    if (!isValidPin(newPin) || newPin !== newPinConfirm) {
      showToast(newPin !== newPinConfirm ? t("pinsDoNotMatch") : t("pinMustBeSixDigits"));
      return;
    }
    const r = await api.changeChildLockPin(newPin);
    setChildLock(r.child_lock);
    setNewPin("");
    setNewPinConfirm("");
    showToast(t("childLockPinChanged"));
  };

  const disableChildLock = async () => {
    const r = await api.disableChildLock();
    setChildLock(r.child_lock);
    showToast(t("childLockDisabled"));
  };

  const lockSettings = async () => {
    const r = await api.lockChildLock();
    setChildLock(r.child_lock);
    showToast(t("settingsLocked"));
  };

  const addChannel = async () => {
    if (!channelUrl.trim() || addingChannel) return;
    setAddingChannel(true);
    try {
      const r = await api.addChannel(channelUrl.trim(), channelCustomName.trim() || undefined);
      showToast(t("channelAdded", { name: channelCustomName.trim() || r.title || r.channel_id }));
      setChannelUrl("");
      setChannelCustomName("");
      await load();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      showToast(message === "HTTP 500" ? t("addChannelNotFoundError") : `${t("error")}: ${message}`);
    } finally {
      setAddingChannel(false);
    }
  };

  const startRenameChannel = (ch: Channel) => {
    setRenamingChannelId(ch.channel_id);
    setRenameValue(ch.custom_title ?? "");
  };

  // Empty input = revert to the original YouTube title (custom_title -> NULL).
  const saveRenameChannel = async (id: string, value: string | null) => {
    try {
      await api.renameChannel(id, value);
      setRenamingChannelId(null);
      emit("channels-changed");
      await load();
    } catch (e) {
      showToast(`${t("error")}: ${e instanceof Error ? e.message : e}`);
    }
  };

  const importFile = async (file: File) => {
    try {
      const r = await api.importFile(file);
      showToast(t("importFound", { found: r.found, added: r.added }));
      load();
    } catch (e) {
      showToast(`${t("importError")}: ${e instanceof Error ? e.message : e}`);
    }
  };

  const addTag = async () => {
    if (!tagName.trim() || addingTag) return;
    setAddingTag(true);
    try {
      await api.addTag(tagName.trim(), tagColor);
      setTagName("");
      load();
      emit("tags-changed");
    } catch (e) {
      showToast(`${t("error")}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAddingTag(false);
    }
  };

  const addRule = async () => {
    if (!ruleTag || !rulePattern.trim()) return;
    const r = await api.addRule({
      tag_id: Number(ruleTag),
      pattern: rulePattern.trim(),
      match_type: ruleMatch,
      field: ruleField,
    });
    showToast(t("ruleTaggedExisting", { n: r.matched }));
    setRulePattern("");
    load();
  };

  const addPlaylist = async () => {
    if (!playlistName.trim()) return;
    await api.createUserPlaylist({ name: playlistName.trim(), icon: playlistIcon });
    setPlaylistName("");
    setPlaylistIcon("ListMusic");
    load();
    emit("playlists-changed");
  };

  const addFilterRule = async () => {
    if (!filterPattern.trim()) return;
    const r = await api.addFilterRule({
      pattern: filterPattern.trim(),
      match_type: filterMatch,
      field: filterField,
      action: filterAction,
      channel_id: filterChannel || null,
    });
    showToast(t("ruleRejected", { n: r.archived }));
    setFilterPattern("");
    load();
  };

  const toggleChannelTag = async (channelId: string, tag: Tag) => {
    const channel = channels.find((ch) => ch.channel_id === channelId);
    const exists = channel?.tags.some((t) => t.id === tag.id);
    if (exists) await api.untagChannel(channelId, tag.id);
    else await api.tagChannel(channelId, tag.id);
    load();
  };

  const createAndAddChannelTag = async (channelId: string) => {
    if (!newChannelTagName.trim()) return;
    const result = await api.addTag(newChannelTagName.trim(), newChannelTagColor);
    await api.tagChannel(channelId, result.tag.id);
    setNewChannelTagName("");
    setTagMenuChannelId(null);
    load();
  };

  const normalizedChannelQuery = channelQuery.trim().toLowerCase();
  const filteredChannels = normalizedChannelQuery
    ? channels.filter((ch) => {
        const title = (ch.title || "").toLowerCase();
        const channelId = ch.channel_id.toLowerCase();
        return title.includes(normalizedChannelQuery) || channelId.includes(normalizedChannelQuery);
      })
    : channels;
  const isSettingsLocked = childLock.enabled && childLock.locked;
  const visibleTabs = TABS.filter((tabItem) =>
    (!tabItem.primaryOnly || isPrimary)
    && (!tabItem.hiddenForChild || isChildProfile === false)
  );

  useEffect(() => {
    if (isChildProfile == null) return;
    if (!visibleTabs.some((tabItem) => tabItem.id === tab)) {
      setTab(visibleTabs[0]?.id ?? "tags");
    }
  }, [isChildProfile, isPrimary, tab]);

  return (
    <>
      <PageHeader title={t("settingsTitle")} />

      {childLock.enabled && !childLock.locked && (
        <button className="settings-unlocked-warning" onClick={lockSettings}>
          <ShieldCheck />
          <span>{t("settingsUnlockedWarning")}</span>
          <strong>{t("lockSettingsNow")}</strong>
        </button>
      )}

      <Tabs variant="settings" className="settings-tabs-layout" label={t("settingsTitle")} value={tab} onChange={setTab} options={visibleTabs.map((tabItem) => ({ value: tabItem.id, label: t(tabItem.labelKey), icon: tabItem.icon, count: tabItem.id === "channels" ? channels.length : undefined }))} />

      {isSettingsLocked && tab !== "tags" && tab !== "playlists" && (
        <SettingsSection className="child-lock-panel">
          <div className="child-lock-header">
            <ShieldCheck />
            <div>
              <div className="switch-label">{t("settingsLockedTitle")}</div>
              <div className="child-lock-description">{t("settingsLockedHint")}</div>
            </div>
          </div>
          <div className="form-row">
            <Input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              placeholder={t("pinPlaceholder")}
              value={unlockPin}
              onChange={(e) => setUnlockPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              onKeyDown={(e) => e.key === "Enter" && unlockSettings()}
            />
            <Button variant="primary" onClick={unlockSettings} disabled={unlockPin.length !== 6}>
              <ShieldCheck /> {t("unlockSettings")}
            </Button>
          </div>
        </SettingsSection>
      )}

      {!isSettingsLocked && tab === "profiles" && isChildProfile === false && (
        <>
          <ProfilesSettings showToast={showToast} />

          <SettingsSection className="child-lock-panel">
            <div className="child-lock-header">
              <ShieldCheck />
              <div>
                <div className="switch-label">{t("childLock")}</div>
                <div className="child-lock-description">{t("childLockHint")}</div>
              </div>
            </div>

            {!isPrimary ? (
              <Text tone="secondary">{t("primaryOnlyHint")}</Text>
            ) : !childLock.enabled ? (
              <>
                <Text tone="secondary">{t("childLockEnableHint")}</Text>
                <div className="form-row">
                  <Input
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    placeholder={t("newPinPlaceholder")}
                    value={enablePin}
                    onChange={(e) => setEnablePin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  />
                  <Input
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    placeholder={t("confirmPinPlaceholder")}
                    value={enablePinConfirm}
                    onChange={(e) => setEnablePinConfirm(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    onKeyDown={(e) => e.key === "Enter" && enableChildLock()}
                  />
                  <Button variant="primary" onClick={enableChildLock} disabled={enablePin.length !== 6 || enablePinConfirm.length !== 6}>
                    <ShieldCheck /> {t("enableChildLock")}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="child-lock-status">
                  <span className="tag-pill">{t("childLockEnabledStatus")}</span>
                  <Button onClick={lockSettings}>{t("lockNow")}</Button>
                  <Button variant="danger" onClick={disableChildLock}>{t("disableChildLock")}</Button>
                </div>
                <Text tone="secondary">{t("changePinHint")}</Text>
                <div className="form-row">
                  <Input
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    placeholder={t("newPinPlaceholder")}
                    value={newPin}
                    onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  />
                  <Input
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    placeholder={t("confirmPinPlaceholder")}
                    value={newPinConfirm}
                    onChange={(e) => setNewPinConfirm(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    onKeyDown={(e) => e.key === "Enter" && changeChildPin()}
                  />
                  <Button variant="primary" onClick={changeChildPin} disabled={newPin.length !== 6 || newPinConfirm.length !== 6}>
                    {t("changePin")}
                  </Button>
                </div>
              </>
            )}
          </SettingsSection>

          {isPrimary && <ChannelOwnership showToast={showToast} />}
        </>
      )}

      {!isSettingsLocked && tab === "auth" && isPrimary && <AuthSettings showToast={showToast} />}

      {!isSettingsLocked && tab === "channels" && (
        <SettingsSection>
          <Tabs variant="subtle" className="settings-subtabs-layout" label={t("channels")} value={channelSubTab} onChange={setChannelSubTab} options={[{ value: "list", label: t("channels"), count: channels.length }, { value: "playlists", label: t("followedPlaylists"), count: followedPlaylists.length }, { value: "filters", label: t("filters"), count: filterRules.length }]} />

          {channelSubTab === "list" && (
            <>
              <Text tone="secondary">{t("addChannelHint")}</Text>
              <div className="form-row">
                <Input
                  type="text"
                  style={{ flex: 1, minWidth: 240 }}
                  placeholder={t("channelLinkPlaceholder")}
                  value={channelUrl}
                  disabled={addingChannel}
                  onChange={(e) => setChannelUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addChannel()}
                />
                <Input
                  type="text"
                  style={{ width: 200 }}
                  placeholder={t("customNameOptional")}
                  value={channelCustomName}
                  disabled={addingChannel}
                  onChange={(e) => setChannelCustomName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addChannel()}
                />
                <Button variant="primary" onClick={addChannel} disabled={addingChannel || !channelUrl.trim()}>
                  {addingChannel ? <LoaderCircle className="spin" /> : <Plus />}
                  {addingChannel ? t("addingChannel") : t("addChannel")}
                </Button>
                <ChannelSearchPicker onAdded={(name) => {
                  showToast(t("channelAdded", { name }));
                  load();
                }} />
                <Button onClick={() => fileRef.current?.click()} disabled={addingChannel}>
                  <FolderUp /> {t("importOpmlCsv")}
                </Button>
                <Input
                  ref={fileRef}
                  type="file"
                  accept=".opml,.xml,.csv"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) importFile(f);
                    e.target.value = "";
                  }}
                />
              </div>
              <div className="form-row">
                <input
                  type="text"
                  style={{ flex: 1, minWidth: 240 }}
                  placeholder={t("searchChannelPlaceholder")}
                  value={channelQuery}
                  onChange={(e) => setChannelQuery(e.target.value)}
                />
              </div>
              {loading && channels.length === 0 ? (
                <TableSkeleton rows={8} columns={5} />
              ) : (
                <table className="list-table list-table--channels">
                  <tbody>
                    {filteredChannels.map((ch) => (
                    <tr key={ch.channel_id}>
                      <td className="shrink">
                        {ch.thumbnail ? (
                          <img className="ch-avatar" src={img(ch.thumbnail)} alt="" />
                        ) : (
                          <div className="ch-avatar ch-avatar-fallback">
                            {(ch.title || ch.channel_id).charAt(0).toUpperCase()}
                          </div>
                        )}
                      </td>
                      <td>
                        {renamingChannelId === ch.channel_id ? (
                          <div className="channel-rename-row">
                            <Input
                              type="text"
                              autoFocus
                              value={renameValue}
                              placeholder={ch.original_title || ch.channel_id}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveRenameChannel(ch.channel_id, renameValue.trim() || null);
                                if (e.key === "Escape") setRenamingChannelId(null);
                              }}
                            />
                            <IconButton variant="ghost" label={t("save")} onClick={() => saveRenameChannel(ch.channel_id, renameValue.trim() || null)}>
                              <Check size={14} />
                            </IconButton>
                            {ch.custom_title && (
                              <IconButton variant="ghost" label={t("revertToOriginalName")} onClick={() => saveRenameChannel(ch.channel_id, null)}>
                                <RotateCcw size={14} />
                              </IconButton>
                            )}
                            <IconButton variant="ghost" label={t("cancel")} onClick={() => setRenamingChannelId(null)}>
                              <X size={14} />
                            </IconButton>
                          </div>
                        ) : (
                          <>
                            <span className="channel-name-wrap">
                              <Link to={`/channel/${ch.channel_id}`} className="channel-name channel-name-link">
                                {ch.title || ch.channel_id}
                              </Link>
                              <IconButton variant="ghost" className="channel-rename-btn" label={t("renameChannel")} onClick={() => startRenameChannel(ch)}>
                                <Pencil size={12} />
                              </IconButton>
                            </span>
                            {ch.custom_title && (
                              <div className="channel-original-name">{t("originalChannelName", { name: ch.original_title || ch.channel_id })}</div>
                            )}
                          </>
                        )}
                        {ch.tags.length > 0 && (
                          <div className="ch-tags">
                            {ch.tags.map((t) => (
                              <TagChip
                                key={t.id}
                                tag={t}
                                onRemove={() => api.untagChannel(ch.channel_id, t.id).then(load)}
                              />
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="shrink">
                        <Popover
                          align="start"
                          surface="menu"
                          className="tag-picker-popover"
                          open={tagMenuChannelId === ch.channel_id}
                          onOpenChange={(open) => setTagMenuChannelId(open ? ch.channel_id : null)}
                          trigger={<Button variant="ghost" size="sm" title={t("manageChannelTags")}>
                            <Plus size={13} /> Tag
                          </Button>}
                        >
                          <TagPickerMenu tags={tags} selectedTagIds={ch.tags.map((tag) => tag.id)} onToggle={(tag) => void toggleChannelTag(ch.channel_id, tag)}>
                            <TagCreateForm title={t("newTag")} name={newChannelTagName} color={newChannelTagColor} placeholder={t("tagNamePlaceholder")} submitLabel={t("addTag")} onNameChange={setNewChannelTagName} onColorChange={setNewChannelTagColor} onSubmit={() => createAndAddChannelTag(ch.channel_id)} />
                          </TagPickerMenu>
                        </Popover>
                      </td>
                      <td className="shrink">
                        <Button
                          variant={ch.followed === 0 ? "primary" : "danger"}
                          title={ch.followed === 0 ? t("followAgain") : t("unfollow")}
                          onClick={async () => {
                            await api.followChannel(ch.channel_id, ch.followed === 0);
                            load();
                          }}
                        >
                          {ch.followed === 0 ? <UserPlus size={15} /> : <UserMinus size={15} />}
                          {ch.followed === 0 ? t("follow") : t("unfollow")}
                        </Button>
                      </td>
                      <td className="shrink">
                        <Popconfirm
                          message={t("confirmDelete", { name: ch.title })}
                          onConfirm={() => api.removeChannel(ch.channel_id).then(load)}
                        >
                          <IconButton label={t("deleteChannel")}>
                            <Trash2 />
                          </IconButton>
                        </Popconfirm>
                      </td>
                    </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {!loading && filteredChannels.length === 0 && (
                <div className="muted" style={{ paddingTop: 8 }}>
                  {t("noMatchingChannels")}
                </div>
              )}
            </>
          )}

          {channelSubTab === "playlists" && (
            followedPlaylists.length === 0 ? <EmptyState title={t("noFollowedPlaylists")} description={t("noFollowedPlaylistsHint")} /> :
            <div className="followed-playlists-settings">
              {followedPlaylists.map((playlist) => <div className="followed-playlist-row" key={playlist.playlist_id}>
                <Link to={`/playlist/${playlist.playlist_id}`} className="followed-playlist-row__identity">
                  {playlist.thumbnail ? <img src={img(playlist.thumbnail)} alt="" /> : <div className="followed-playlist-row__placeholder"><ListMusic /></div>}
                  <span><strong>{playlist.title}</strong><small>{playlist.channel_title}</small></span>
                </Link>
                <span className="muted">{playlist.video_count ? formatVideoCount(Number.parseInt(playlist.video_count, 10) || 0, language) : ""}</span>
                <Button size="sm" leadingIcon={<RefreshCw />} onClick={async () => { await api.syncPlaylist(playlist.playlist_id); loadFollowedPlaylists(); }}>{t("syncPlaylist")}</Button>
                <Button size="sm" variant="danger" leadingIcon={<ListMinus />} onClick={async () => { await api.followPlaylist(playlist.playlist_id, false); loadFollowedPlaylists(); }}>{t("unfollowPlaylist")}</Button>
              </div>)}
            </div>
          )}

          {channelSubTab === "filters" && (
            <>
              <Text tone="secondary">
                {t("filterHint")}
              </Text>
              <div className="form-row" style={{ flexWrap: "wrap" }}>
                <Input
                  type="text"
                  placeholder={t("patternPlaceholder")}
                  style={{ flex: 1, minWidth: 160 }}
                  value={filterPattern}
                  onChange={(e) => setFilterPattern(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addFilterRule()}
                />
                <SelectMenu label={t("contains")} value={filterMatch} options={[{ value: "contains", label: t("contains") }, { value: "regex", label: "regex" }]} onChange={setFilterMatch} />
                <SelectMenu label={t("inTitle")} value={filterField} options={[{ value: "title", label: t("inTitle") }, { value: "description", label: t("inDescription") }, { value: "both", label: t("titleOrDescription") }]} onChange={setFilterField} />
                <SelectMenu label={t("rejectMatching")} value={filterAction} options={[{ value: "reject", label: t("rejectMatching") }, { value: "whitelist", label: t("onlyMatching") }]} onChange={setFilterAction} />
                <SelectMenu label={t("allChannels")} value={filterChannel} options={[{ value: "", label: t("allChannels") }, ...channels.filter((channel) => channel.followed !== 0).map((channel) => ({ value: channel.channel_id, label: channel.title || channel.channel_id }))]} onChange={setFilterChannel} searchable searchPlaceholder={t("searchChannelPlaceholder")} />
                <Button variant="primary" onClick={addFilterRule} disabled={!filterPattern.trim()}>
                  <Plus /> {t("addFilter")}
                </Button>
              </div>
              {loading && filterRules.length === 0 ? (
                <TableSkeleton rows={5} columns={3} />
              ) : (
                <FilterRuleGroups rules={filterRules} channels={channels} onSave={async (id, patch) => { await api.updateFilterRule(id, patch); load(); }} onRemove={(id) => api.removeFilterRule(id).then(load)} />
              )}
              {!loading && filterRules.length === 0 && <div className="muted" style={{ paddingTop: 8 }}>{t("noFilterRules")}</div>}
            </>
          )}
        </SettingsSection>
      )}

      {tab === "tags" && (
        <SettingsSection>
          <Tabs variant="subtle" className="settings-subtabs-layout" label={t("tagsRules")} value={tagSubTab} onChange={setTagSubTab} options={[{ value: "list", label: t("tags"), count: tags.length }, { value: "rules", label: t("rules"), count: rules.length }]} />

          {tagSubTab === "list" && (
            <>
              <Text tone="secondary">
                {t("tagHint")}
              </Text>
              <div className="form-row">
                <Input
                  type="text"
                  placeholder={t("tagNameExample")}
                  value={tagName}
                  disabled={addingTag}
                  onChange={(e) => setTagName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addTag()}
                />
                <ColorPicker label={t("newTag")} value={tagColor} disabled={addingTag} onChange={setTagColor} variant="swatch" />
                <Button variant="primary" onClick={addTag} disabled={addingTag || !tagName.trim()}>
                  {addingTag ? <LoaderCircle className="spin" /> : <Plus />} {t("addTag")}
                </Button>
              </div>
              {loading && tags.length === 0 ? (
                <TableSkeleton rows={6} columns={3} />
              ) : (
                <table className="list-table">
                  <tbody>
                    {tags.map((t) => (
                      <TagRow key={t.id} tag={t} onSave={async (patch) => { await api.updateTag(t.id, patch); load(); emit("tags-changed"); }} onRemove={() => api.removeTag(t.id).then(() => { load(); emit("tags-changed"); })} />
                    ))}
                  </tbody>
                </table>
              )}
              {!loading && tags.length === 0 && <div className="muted" style={{ paddingTop: 8 }}>{t("noTags")}</div>}
            </>
          )}

          {tagSubTab === "rules" && (
            <>
              <Text tone="secondary">
                {t("ruleHint")}
              </Text>
              <div className="form-row">
                <Input
                  type="text"
                  placeholder={t("patternPlaceholder")}
                  value={rulePattern}
                  onChange={(e) => setRulePattern(e.target.value)}
                />
                <SelectMenu label={t("contains")} value={ruleMatch} options={[{ value: "contains", label: t("contains") }, { value: "regex", label: "regex" }]} onChange={setRuleMatch} />
                <SelectMenu label={t("inTitle")} value={ruleField} options={[{ value: "title", label: t("inTitle") }, { value: "description", label: t("inDescription") }, { value: "both", label: t("titleOrDescription") }]} onChange={setRuleField} />
                <span className="muted">-&gt; tag:</span>
                <SelectMenu label={t("chooseTag")} value={ruleTag} options={[{ value: "" as const, label: t("chooseTag") }, ...tags.map((tag) => ({ value: tag.id, label: tag.name }))]} onChange={setRuleTag} searchable searchPlaceholder={t("search")} />
                <Button variant="primary" onClick={addRule}>
                  <Plus /> {t("addRule")}
                </Button>
              </div>
              {loading && rules.length === 0 ? (
                <TableSkeleton rows={6} columns={3} />
              ) : (
                <table className="list-table">
                  <tbody>
                    {rules.map((r) => (
                      <RuleRow key={r.id} rule={r} tags={tags} onSave={async (patch) => { await api.updateRule(r.id, patch); load(); }} onRemove={() => api.removeRule(r.id).then(load)} />
                    ))}
                  </tbody>
                </table>
              )}
              {!loading && rules.length === 0 && <div className="muted" style={{ paddingTop: 8 }}>{t("noTagRules")}</div>}
            </>
          )}
        </SettingsSection>
      )}

      {tab === "playlists" && (
        <SettingsSection>
          <Text tone="secondary">
            {t("playlistHint")}
          </Text>
          {loading && playlists.length === 0 ? (
            <TableSkeleton rows={4} columns={2} />
          ) : (
            <div className="playlist-settings-list">
              {playlists.map((p) => (
                <PlaylistSettingsItem
                  key={p.id}
                  playlist={p}
                  rules={playlistRules[p.id] ?? []}
                  reload={load}
                  showToast={showToast}
                />
              ))}
            </div>
          )}
          <div className="form-row" style={{ marginTop: 16 }}>
            <PlaylistIconPicker value={playlistIcon} onChange={setPlaylistIcon} />
            <Input
              type="text"
              placeholder={t("newPlaylistName")}
              value={playlistName}
              onChange={(e) => setPlaylistName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addPlaylist()}
            />
            <Button variant="primary" onClick={addPlaylist}>
              <Plus /> {t("newPlaylist")}
            </Button>
            <Button onClick={() => navigate("/import")}>
              <FolderUp /> {t("importTakeout")}
            </Button>
          </div>
          <Text tone="secondary">{t("importTakeoutHint")}</Text>
        </SettingsSection>
      )}

      {!isSettingsLocked && tab === "display" && (
        <div className="settings-display-groups">
          <SettingsSection title={t("displayAppearance")} className="settings-display-group">
          {isPrimary ? (
            <>
              <SettingRow label={t("appNameLabel")} htmlFor="app-name">
                <div style={{ display: "flex", gap: 8 }}>
                  <Input
                    id="app-name"
                    type="text"
                    className="form-input"
                    style={{ flex: 1 }}
                    value={appNameInput}
                    placeholder={t("appNamePlaceholder")}
                    onChange={(e) => setAppNameInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveAppName()}
                  />
                  <Button onClick={saveAppName} disabled={appNameInput.trim() === appName}>{t("save")}</Button>
                </div>
              </SettingRow>

              <SettingRow label={t("appIconColorLabel")} htmlFor="app-icon-color">
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span className="logo-mark" style={{ background: appIconColor }}>
                    <Play fill="currentColor" size={16} />
                  </span>
                  <ColorPicker
                    id="app-icon-color"
                    label={t("appIconColorLabel")}
                    value={appIconColor}
                    onChange={saveAppIconColor}
                  />
                </div>
              </SettingRow>
            </>
          ) : (
            <Text tone="secondary">{t("primaryOnlyHint")}</Text>
          )}
          </SettingsSection>

          <SettingsSection title={t("displayFeed")} className="settings-display-group">
          <SettingRow label={t("showShorts")} description={t("showShortsHint")}>
            <Switch checked={showShorts} onCheckedChange={() => toggleShorts()} />
          </SettingRow>

          <SettingRow label={t("hideLiveFromFeed")} description={t("hideLiveFromFeedHint")}>
            <Switch checked={hideLiveFromFeed} onCheckedChange={() => toggleLiveFromFeed()} />
          </SettingRow>

          <SettingRow label={t("membersOnlyVisibility")} description={t("membersOnlyVisibilityHint")}>
            <SelectMenu
              label={t("membersOnlyVisibility")}
              value={membersOnlyVisibility}
              onChange={changeMembersOnlyVisibility}
              options={[
                { value: "everywhere", label: t("channelMembersOnlyEverywhere") },
                { value: "channel", label: t("channelMembersOnlyChannelOnly") },
                { value: "hidden", label: t("channelMembersOnlyNowhere") },
              ]}
            />
          </SettingRow>

          <div className="watched-style-setting">
            <div>
              <div className="switch-label">{t("watchedStyleLabel")}</div>
              <div className="switch-sub">{t("watchedStyleHint")}</div>
            </div>
            <div className="watched-style-segmented" role="radiogroup" aria-label={t("watchedStyleLabel")}>
              {WATCHED_STYLES.map((style) => (
                <button
                  key={style.id}
                  type="button"
                  role="radio"
                  aria-checked={watchedStyle === style.id}
                  className={`watched-style-option${watchedStyle === style.id ? " active" : ""}`}
                  title={t(style.labelKey)}
                  onClick={() => changeWatchedStyle(style.id)}
                >
                  <span className={`watched-style-preview watched-style-preview--${style.id}`} aria-hidden="true">
                    <span className="watched-style-preview-image" />
                    <span className="watched-style-preview-progress" />
                    <span className="watched-style-preview-check"><Check size={7} strokeWidth={3} /></span>
                  </span>
                  <span>{t(style.labelKey)}</span>
                </button>
              ))}
            </div>
          </div>

          <SettingRow label={t("showTopChannels")} description={t("showTopChannelsHint")}>
            <Switch checked={showTopChannels} onCheckedChange={() => toggleTopChannels()} />
          </SettingRow>

          </SettingsSection>

          <SettingsSection title={t("displayLanguage")} className="settings-display-group">
          <SettingRow label={t("uiLanguage")}>
            <SelectMenu
              label={t("uiLanguage")}
              value={language}
              options={LANGUAGES.map((code) => ({ value: code, label: languageName(code) }))}
              onChange={(next) => {
                setLanguage(next).then(() => showToast(t("displaySettingsSaved"))).catch(console.error);
              }}
            />
          </SettingRow>
          </SettingsSection>

          <SettingsSection title={t("displayPlayback")} className="settings-display-group">
          <SettingRow label={t("forceCaptions")} description={t("forceCaptionsHint")}>
            <Switch
              checked={playerCc}
              onCheckedChange={(next) => {
                setPlayerCc(next);
                savePlayer({ player_cc: next ? "1" : "0" });
              }}
            />
          </SettingRow>
          <SettingRow label={t("playerLanguage")}>
            <SelectMenu
              label={t("playerLanguage")}
              value={playerHl}
              options={[{ value: "pl", label: "polski" }, { value: "en", label: "English" }, { value: "de", label: "Deutsch" }, { value: "es", label: "español" }, { value: "fr", label: "français" }, { value: "uk", label: "українська" }, { value: "ja", label: "日本語" }]}
              onChange={(next) => {
                setPlayerHl(next);
                savePlayer({ player_hl: next, player_cc_lang: next });
              }}
            />
          </SettingRow>

          <div className="sub-style-panel">
            <div>
              <div className="switch-label">{t("subtitleStyleTitle")}</div>
              <div className="switch-sub">{t("subtitleStyleHint")}</div>
            </div>
            <div className="sub-style-controls">
              <label className="sub-style-field">
                <span>{t("subtitleSize")}</span>
                <InputGroup suffix="px" className="sub-size-input">
                  <Input
                    type="number"
                    min={12}
                    max={48}
                    step={1}
                    value={subSize}
                    onChange={(e) => setSubSize(Math.min(48, Math.max(12, Number(e.target.value) || 12)))}
                    onBlur={() => savePlayer({ player_sub_size: String(subSize) })}
                  />
                </InputGroup>
              </label>
              <label className="sub-style-field">
                <span>{t("subtitleColor")}</span>
                <ColorPicker
                  label={t("subtitleColor")}
                  value={subColor}
                  onChange={(next) => { setSubColor(next); savePlayer({ player_sub_color: next }); }}
                />
              </label>
              <label className="sub-style-field sub-style-field--wide">
                <span>{t("subtitleBackground")} ({subBg}%)</span>
                <Slider
                  min={0}
                  max={100}
                  step={5}
                  value={subBg}
                  onChange={setSubBg}
                  onPointerUp={() => savePlayer({ player_sub_bg: String(subBg) })}
                />
              </label>
            </div>
            <div className="sub-style-preview">
              <span style={{ color: subColor, background: `rgba(0, 0, 0, ${subBg / 100})`, fontSize: `${subSize}px` }}>
                {t("subtitlePreviewLine")}
              </span>
            </div>
          </div>

          <SettingRow label={t("quality")} description={t("qualityHint")}>
            <SelectMenu
              label={t("quality")}
              value={playerQuality}
              options={[{ value: "auto", label: t("autoQuality") }, { value: "hd2160", label: "4K (2160p)" }, { value: "hd1440", label: "1440p" }, { value: "hd1080", label: "1080p" }, { value: "hd720", label: "720p" }, { value: "large", label: "480p" }, { value: "medium", label: "360p" }]}
              onChange={(next) => {
                setPlayerQuality(next);
                savePlayer({ player_quality: next });
              }}
            />
          </SettingRow>

          <SettingRow label={t("playbackSpeed")} description={t("playbackSpeedHint")}>
            <SelectMenu
              label={t("playbackSpeed")}
              value={playerSpeed}
              options={PLAYBACK_SPEEDS.map((speed) => ({ value: String(speed), label: `${speed}×` }))}
              onChange={(next) => {
                setPlayerSpeed(next);
                savePlayer({ player_speed: next });
              }}
            />
          </SettingRow>

          <SettingRow label={t("keyboardSeekSeconds")} description={t("keyboardSeekSecondsHint")}>
            <SelectMenu
              label={t("keyboardSeekSeconds")}
              value={keyboardSeekSeconds}
              options={[3, 5, 10, 15, 30].map((seconds) => ({ value: String(seconds), label: `${seconds} s` }))}
              onChange={(next) => {
                setKeyboardSeekSeconds(next);
                savePlayer({ keyboard_seek_seconds: next });
              }}
            />
          </SettingRow>

          <SettingRow
            label={t("autoFullscreenLandscape")}
            description={<>{t("autoFullscreenLandscapeHint")}<br />{t("autoFullscreenLandscapeCaveat")}</>}
          >
            <Switch
              checked={autoFullscreen}
              onCheckedChange={(next) => {
                setAutoFullscreen(next);
                savePlayer({ auto_fullscreen_landscape: next ? "1" : "0" });
              }}
            />
          </SettingRow>
          </SettingsSection>

          <SettingsSection title={t("displayEnhancements")} className="settings-display-group">
          <SettingRow label="SponsorBlock" description={t("sponsorblockHint")}>
            <Switch checked={sbEnabled} onCheckedChange={() => toggleSb()} />
          </SettingRow>

          {sbEnabled && (
            <div className="sb-category-grid">
              <div className="switch-sub" style={{ gridColumn: "1 / -1", marginBottom: 2 }}>{t("sponsorblockCategories")}</div>
              {SB_CATEGORIES.map((cat) => {
                const active = sbCategories.includes(cat.id);
                return (
                  <div key={cat.id} className="sb-category-row">
                    <span className="sb-category-dot" style={{ background: cat.color }} />
                    <span className="sb-category-name">{t(cat.labelKey)}</span>
                    <Switch checked={active} onCheckedChange={() => toggleSbCategory(cat.id)} />
                  </div>
                );
              })}
            </div>
          )}
          </SettingsSection>

          <SettingsSection title={t("displayNavigation")} className="settings-display-group">
          <div className="sidebar-order-head">
            <div>
              <div className="switch-label">{t("sidebarOrderTitle")}</div>
              <div className="switch-sub">{t("sidebarOrderHint")}</div>
            </div>
            <Popconfirm message={t("resetOrderConfirm")} onConfirm={resetNavConfig}>
              <Button>{t("resetOrder")}</Button>
            </Popconfirm>
          </div>
          <SidebarNavEditor value={navConfig} onChange={persistNavConfig} />
          </SettingsSection>
        </div>
      )}

      {!isSettingsLocked && tab === "plugins" && (
        <SettingsSection>
          <Alert variant="info">{t("pluginSettingsHint")}</Alert>
          <div className="plugin-settings-list">
            {plugins.map((plugin) => (
              <div key={plugin.id} className="plugin-settings-row">
                <div className="plugin-settings-main">
                  <div className="plugin-settings-name">{plugin.name}</div>
                  <div className="plugin-settings-description">{plugin.description}</div>
                  <div className="plugin-permissions">
                    {plugin.permissions.map((permission) => (
                      <Badge key={permission} size="sm">{permission}</Badge>
                    ))}
                  </div>
                </div>
                <div className="plugin-settings-actions">
                  {pluginSettings[plugin.id]?.definitions.length > 0 && (
                    <Button className="plugin-configure-btn" onClick={() => setPluginSettingsModalId(plugin.id)}>
                      <Wrench size={15} />
                      {t("configure")}
                    </Button>
                  )}
                  <Switch checked={plugin.enabled} onCheckedChange={() => togglePlugin(plugin)} />
                </div>
              </div>
            ))}
          </div>
          {pluginSettingsModalId && (() => {
            const plugin = plugins.find((p) => p.id === pluginSettingsModalId);
            const config = pluginSettings[pluginSettingsModalId];
            if (!plugin || !config) return null;
            const discoverySections = [
              {
                id: "display",
                title: t("pluginSectionDisplay"),
                description: t("pluginSectionDisplayHint"),
                keys: ["total_limit", "per_channel_limit", "early_external_count", "random_pick_count", "high_pick_count"],
              },
              {
                id: "personalization",
                title: t("pluginSectionPersonalization"),
                description: t("pluginSectionPersonalizationHint"),
                keys: ["shared_tag_points", "tag_history_points", "tag_history_cap", "watched_channel_points", "watched_channel_cap", "playlist_points", "liked_points", "already_watched_points", "started_points", "recency_points"],
              },
              {
                id: "outside",
                title: t("pluginSectionOutside"),
                description: t("pluginSectionOutsideHint"),
                keys: ["external_adjustment", "outside_base_points", "outside_exact_match_points", "outside_partial_match_points"],
              },
            ];
            const downloadsSections = [
              {
                id: "downloading",
                title: t("pluginSectionDownloading"),
                description: t("pluginSectionDownloadingHint"),
                keys: ["quality", "watch_source_mode", "thumb_progress", "download_scheduled", "download_feed", "feed_max_age_hours", "feed_min_duration_minutes", "download_shorts"],
              },
              {
                id: "files",
                title: t("pluginSectionFiles"),
                description: t("pluginSectionFilesHint"),
                keys: ["output_template", "write_thumbnail", "embed_metadata", "write_info_json", "write_nfo", "write_subs", "write_auto_subs", "sub_langs"],
              },
              {
                id: "retention",
                title: t("pluginSectionRetention"),
                description: t("pluginSectionRetentionHint"),
                keys: ["retention_days", "delete_watched", "delete_watched_hours", "keep_liked", "max_storage_gb"],
              },
            ];
            const sectionKeys = plugin.id === "discovery" ? discoverySections : plugin.id === "downloads" ? downloadsSections : null;
            const sections = sectionKeys
              ? sectionKeys.map((section) => ({
                  ...section,
                  definitions: section.keys.flatMap((key) => config.definitions.filter((def) => def.key === key)),
                })).filter((section) => section.definitions.length > 0)
              : [{
                  id: "general",
                  title: t("pluginSectionGeneral"),
                  description: t("pluginSectionGeneralHint"),
                  definitions: config.definitions,
                }];
            return createPortal(
              <div className="plugin-modal-backdrop" onMouseDown={() => setPluginSettingsModalId(null)}>
                <div className="plugin-modal" role="dialog" aria-modal="true" aria-labelledby="plugin-settings-title" onMouseDown={(e) => e.stopPropagation()}>
                  <div className="plugin-modal-hero">
                    <div className="plugin-modal-icon" aria-hidden="true">
                      {plugin.icon === "Sparkles" ? <Sparkles /> : plugin.icon === "Download" ? <Download /> : <Plug />}
                    </div>
                    <div className="plugin-modal-identity">
                      <div className="plugin-modal-eyebrow">{t("pluginDetailsLabel")}</div>
                      <h2 id="plugin-settings-title">{plugin.name}</h2>
                      <p>{plugin.description}</p>
                      <div className="plugin-modal-meta">
                        <span>v{plugin.version}</span>
                        <span className={`plugin-status${plugin.enabled ? " enabled" : ""}`}>
                          <span />{plugin.enabled ? t("pluginEnabled") : t("pluginDisabled")}
                        </span>
                      </div>
                    </div>
                    <IconButton className="plugin-modal-close" label={t("close")} onClick={() => setPluginSettingsModalId(null)}>
                      <X />
                    </IconButton>
                  </div>
                  <div className="plugin-modal-permissions">
                    <ShieldCheck size={16} />
                    <div>
                      <strong>{t("pluginPermissionsTitle")}</strong>
                      <div>{plugin.permissions.join(" · ")}</div>
                    </div>
                  </div>
                  <div className="plugin-modal-content">
                    <div className="plugin-modal-content-head">
                      <span>{t("pluginConfigurationTitle")}</span>
                      <span>{config.definitions.length}</span>
                    </div>
                    {sections.map((section) => (
                      <section className="plugin-config-section" key={section.id}>
                        <div className="plugin-config-section-head">
                          <h3>{section.title}</h3>
                          <p>{section.description}</p>
                        </div>
                        <div className="plugin-modal-controls">
                          {section.definitions.map((def) => {
                            const value = config.settings[def.key] ?? def.defaultValue;
                            return (
                              <div key={def.key} className={`plugin-slider-row${def.type === "multiselect" ? " plugin-slider-row--stacked" : ""}`}>
                                <div className="plugin-slider-copy">
                                  <span className="switch-label">{def.label}</span>
                                  <span className="switch-sub">{def.description}</span>
                                </div>
                                {def.type === "toggle" ? (
                                  <Switch checked={Number(value) === 1} onCheckedChange={(next) => updatePluginSetting(plugin.id, def.key, next ? 1 : 0)} />
                                ) : def.type === "multiselect" ? (
                                  <PluginMultiselect
                                    value={String(value)}
                                    options={def.options ?? []}
                                    searchPlaceholder={t("searchLanguagePlaceholder")}
                                    onChange={(next) => updatePluginSetting(plugin.id, def.key, next)}
                                  />
                                ) : def.type === "text" ? (
                                  <Input
                                    type="text"
                                    className="plugin-text-input"
                                    defaultValue={String(value)}
                                    // Commit on blur/Enter so typing doesn't fire a request per keystroke.
                                    onBlur={(e) => {
                                      const next = e.target.value.trim();
                                      if (next !== String(value)) updatePluginSetting(plugin.id, def.key, next);
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                    }}
                                  />
                                ) : def.type === "select" ? (
                                  <SelectMenu
                                    label={def.label}
                                    value={String(value)}
                                    options={def.options?.map((option) => ({ value: option.value, label: option.label })) ?? []}
                                    onChange={(next) => updatePluginSetting(plugin.id, def.key, next)}
                                  />
                                ) : (
                                  <div className="plugin-slider-control">
                                    <Slider min={def.min ?? 0} max={def.max ?? 100} step={def.step} value={Number(value)} onChange={(next) => updatePluginSetting(plugin.id, def.key, next)} />
                                    <Input type="number" min={def.min} max={def.max} step={def.step} value={Number(value)} onChange={(e) => updatePluginSetting(plugin.id, def.key, Number(e.target.value))} />
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    ))}
                    {plugin.id === "downloads" && <DownloadCookiesPanel />}
                  {config.terms && (
                    <section className="plugin-config-section plugin-terms-panel">
                      <div className="plugin-terms-head">
                        <h3>{t("pluginTermsTitle")}</h3>
                        <p>{t("pluginTermsHint")}</p>
                      </div>
                      <div className="plugin-term-group">
                        <div className="plugin-term-label">{t("pluginTermsFound")}</div>
                        <div className="plugin-term-list">
                          {config.terms.lastTerms.length === 0 && <span className="plugin-term-empty">{t("pluginTermsEmpty")}</span>}
                          {config.terms.lastTerms.map((term) => {
                            const blocked = config.terms?.blockedTerms.includes(term);
                            return (
                              <button
                                key={term}
                                className={`plugin-term-chip${blocked ? " blocked" : ""}`}
                                onClick={() => updatePluginBlockedTerms(
                                  plugin.id,
                                  blocked
                                    ? (config.terms?.blockedTerms ?? []).filter((item) => item !== term)
                                    : [...(config.terms?.blockedTerms ?? []), term],
                                )}
                              >
                                {term}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      {config.terms.blockedTerms.length > 0 && (
                        <div className="plugin-term-group">
                          <div className="plugin-term-label">{t("pluginTermsBlocked")}</div>
                          <div className="plugin-term-list">
                            {config.terms.blockedTerms.map((term) => (
                              <button
                                key={term}
                                className="plugin-term-chip blocked"
                                onClick={() => updatePluginBlockedTerms(plugin.id, config.terms!.blockedTerms.filter((item) => item !== term))}
                              >
                                {term}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </section>
                  )}
                  </div>
                  <div className="plugin-modal-footer">
                    <div>
                      <strong>{t("pluginResetTitle")}</strong>
                      <span>{t("pluginResetHint")}</span>
                    </div>
                    <Popconfirm message={t("pluginResetConfirm")} onConfirm={() => resetPlugin(plugin.id)}>
                      <Button variant="danger" className="plugin-reset-btn" disabled={resettingPluginId === plugin.id}>
                        {resettingPluginId === plugin.id ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}
                        {t("pluginResetAction")}
                      </Button>
                    </Popconfirm>
                  </div>
                </div>
              </div>,
              document.body
            );
          })()}
        </SettingsSection>
      )}

      {!isSettingsLocked && tab === "advanced" && (
        <SettingsSection>
          <Tabs variant="subtle" className="settings-subtabs-layout" label={t("advanced")} value={advancedSubTab} onChange={setAdvancedSubTab} options={[{ value: "external", label: t("navExternal"), count: externalVideos.length }, { value: "logs", label: t("logs") }, { value: "changelog", label: t("changelog") }]} />

          {advancedSubTab === "external" && (
            <>
              <Inline justify="between" align="start" className="settings-advanced-head">
                <Text tone="secondary">{t("externalHint")}</Text>
            {externalVideos.length > 0 && (
              <Button variant="danger" onClick={clearExternal} disabled={clearingExternal}>
                {clearingExternal ? <LoaderCircle size={15} className="spin" /> : <Trash2 size={15} />}
                {t("externalClear")}
              </Button>
            )}
          </Inline>
          {loadingExternal && externalVideos.length === 0 ? (
            <TableSkeleton />
          ) : externalVideos.length === 0 ? (
            <EmptyState icon={<Clock />} title={t("externalEmpty")} />
          ) : (() => {
            const byChannel = Object.values(
              externalVideos.reduce<Record<string, { channel_id: string; channel_title: string; channel_thumbnail: string | null; videos: typeof externalVideos }>>(
                (acc, v) => {
                  if (!acc[v.channel_id]) acc[v.channel_id] = { channel_id: v.channel_id, channel_title: v.channel_title, channel_thumbnail: v.channel_thumbnail, videos: [] };
                  acc[v.channel_id].videos.push(v);
                  return acc;
                },
                {}
              )
            );
            return (
              <div className="external-groups">
                {byChannel.map((ch) => (
                  <div key={ch.channel_id} className="external-group">
                    <div className="external-group-header">
                      {ch.channel_thumbnail ? (
                        <img className="external-ch-avatar" src={img(ch.channel_thumbnail)} alt="" />
                      ) : (
                        <div className="external-ch-avatar external-ch-avatar-fallback">
                          {ch.channel_title.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <span className="external-ch-name">{ch.channel_title}</span>
                      <Button
                        variant="primary"
                        onClick={() => followExternalChannel(ch.channel_id)}
                        style={{ marginLeft: "auto", flexShrink: 0 }}
                      >
                        <UserPlus size={14} />
                        {t("follow")}
                      </Button>
                      <Button
                        variant="danger"
                        onClick={() => removeExternalChannel(ch.channel_id)}
                        style={{ flexShrink: 0 }}
                      >
                        <Trash2 size={14} />
                        {t("externalClearChannel")}
                      </Button>
                    </div>
                    <div className="external-video-list">
                      {ch.videos.map((v) => (
                        <div key={v.video_id} className="external-video-row">
                          <Link to={`/watch/${v.video_id}`} className="external-thumb-link" aria-label={v.title} title={v.title}>
                            <VideoThumbnail src={img(v.thumbnail)} watched={v.watched === 1} progress={watchProgress(v.watch_position, v.watch_duration)} variant="external" loading="lazy" />
                          </Link>
                          <Link to={`/watch/${v.video_id}`} className="external-title-cell" title={v.title}>
                            {v.title}
                          </Link>
                          <IconButton
                            variant="danger"
                            label={t("delete")}
                            onClick={() => removeExternal(v.video_id)}
                          >
                            <Trash2 size={15} />
                          </IconButton>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
            </>
          )}

          {advancedSubTab === "logs" && (
            <>
              <Inline justify="between" align="start" className="settings-advanced-head">
                <Text tone="secondary">{t("logsHint")}</Text>
            <Button onClick={loadLogs} disabled={loadingLogs}>
              {loadingLogs ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}
              {t("refresh")}
            </Button>
          </Inline>
          {logs && (
            <Alert variant="info" icon={<Info />}><span>{t("logsReportHint")} <code>{logs.version} ({logs.commit})</code></span></Alert>
          )}
          {loadingLogs && !logs ? (
            <TableSkeleton rows={8} columns={1} />
          ) : !logs || logs.lines.length === 0 ? (
            <EmptyState icon={<FileText />} title={t("logsEmpty")} />
          ) : (
            <>
              <div className="logs-meta">
                {t("logsShowing", { count: logs.lines.length, size: logs.size.toLocaleString(locale) })}
              </div>
              <div className="logs-viewer">
                {logs.lines.map((line, i) => (
                  <LogLine key={`${i}-${line}`} line={line} />
                ))}
              </div>
            </>
          )}
            </>
          )}

          {advancedSubTab === "changelog" && (
            <div className="settings-changelog">
              <SectionHeader
                className="settings-changelog-head"
                title={t("currentVersion")}
                description={appVersion ? <code className="settings-version-code">{appVersion.version} ({appVersion.commit})</code> : <LoaderCircle size={15} className="spin" />}
                actions={<Button onClick={checkForUpdates} disabled={checkingUpdates}>
                  {checkingUpdates ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}
                  {checkingUpdates ? t("checkingUpdates") : t("checkForUpdates")}
                </Button>}
              />

              <SettingRow label={t("automaticUpdateChecks")} description={t("automaticUpdateChecksHint")}>
                <SelectMenu
                  label={t("automaticUpdateChecks")}
                  value={updateCheckInterval}
                  options={[
                    { value: "off", label: t("automaticUpdateChecksOff") },
                    { value: "1", label: t("everyHour") },
                    { value: "3", label: t("everyHours", { count: 3 }) },
                    { value: "6", label: t("everyHours", { count: 6 }) },
                    { value: "12", label: t("everyHours", { count: 12 }) },
                    { value: "24", label: t("everyDay") },
                    { value: "72", label: t("everyDays", { count: 3 }) },
                    { value: "168", label: t("everyDays", { count: 7 }) },
                  ]}
                  onChange={(next) => {
                    const previous = updateCheckInterval;
                    setUpdateCheckInterval(next);
                    api.updateSettings({ update_check_interval: next })
                      .then(() => emit("update-check-settings-changed"))
                      .catch((error) => { setUpdateCheckInterval(previous); console.error(error); });
                  }}
                />
              </SettingRow>

              {updateCheckError && (
                <Alert variant="danger" title={t("updateCheckFailed")}>{t("updateCheckFailedHint")}</Alert>
              )}

              {updateCheck && (
                <Alert
                  className="settings-update-status"
                  variant={updateCheck.updateAvailable === true ? "warning" : updateCheck.updateAvailable === false ? "success" : "info"}
                  icon={updateCheck.updateAvailable === true ? <Sparkles /> : updateCheck.updateAvailable === false ? <CheckCircle2 /> : <Info />}
                  title={updateCheck.updateAvailable === true ? t("updateAvailable") : updateCheck.updateAvailable === false ? t("upToDate") : t("developmentVersion")}
                >
                  {updateCheck.updateAvailable === true && (
                    <div className="settings-version-comparison" aria-label={`${updateCheck.currentVersion} → ${updateCheck.latestVersion ?? "—"}`}>
                      <code>{updateCheck.currentVersion}</code>
                      <ArrowRight aria-hidden="true" />
                      <code>{updateCheck.latestVersion ?? "—"}</code>
                    </div>
                  )}
                  {updateCheck.updateAvailable === false && <span>{t("noNewerVersionHint", { version: updateCheck.currentVersion })}</span>}
                  {updateCheck.updateAvailable === null && (
                    <span>{t("developmentVersionHint")} {t("latestVersion")}: <strong>{updateCheck.latestVersion ?? "—"}</strong></span>
                  )}
                  {updateCheck.latestVersion && (
                    <ButtonAnchor className="settings-update-link" size="sm" href={updateCheck.latestUrl} target="_blank" rel="noreferrer" leadingIcon={<ExternalLink size={14} />}>
                      {t("viewOnGitHub")}
                    </ButtonAnchor>
                  )}
                </Alert>
              )}

              <SectionHeader className="settings-changelog-list-head" title={t("changelog")} description={t("changelogHint")} variant="subtle" />

              {!changelog ? (
                <TableSkeleton rows={4} columns={1} />
              ) : changelog.releases.length === 0 ? (
                <EmptyState icon={<FileText />} title={t("changelogEmpty")} />
              ) : (
                <div className="settings-release-list">
                  {changelog.releases.map((release) => (
                    <article className="settings-release" key={release.version}>
                      <header className="settings-release-head">
                        <div>
                          <strong>{release.name}</strong>
                          {release.publishedAt && <span>{new Date(release.publishedAt).toLocaleDateString(locale)}</span>}
                        </div>
                        <div className="settings-release-actions">
                          <ButtonAnchor size="sm" variant="ghost" href={release.url} target="_blank" rel="noreferrer" leadingIcon={<ExternalLink size={13} />}>
                            GitHub
                          </ButtonAnchor>
                        </div>
                      </header>
                      {release.notes.length > 0 && (
                        <ul>{release.notes.map((note, noteIndex) => <li key={`${release.version}-${noteIndex}`}><ChangelogNote>{note}</ChangelogNote></li>)}</ul>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}
        </SettingsSection>
      )}
    </>
  );
}
