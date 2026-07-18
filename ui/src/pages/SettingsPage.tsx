import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useSearchParams } from "react-router-dom";
import { Camera, Check, ChevronDown, ChevronUp, Clock, Download, Eye, EyeOff, FileText, Filter, FolderUp, GripVertical, Info, KeyRound, LoaderCircle, ListMusic, MonitorPlay, Pencil, Play, Plug, Plus, RefreshCw, RotateCcw, ShieldCheck, Sparkles, Tags, Trash2, Tv, UserMinus, UserPlus, Users, Wrench, X, Zap } from "lucide-react";
import { api, type AppLogs, type Channel, type ChildConfig, type ChildLockStatus, type FilterRule, type PluginManifest, type PluginSettingsResponse, type Profile, type Rule, type Tag, type UserPlaylist, type UserPlaylistRule, type Video, SB_CATEGORIES, PLAYBACK_SPEEDS } from "../api";
import { ProfileAvatar } from "../components/ProfileMenu";
import AuthSettings from "../components/AuthSettings";
import { NAV_ITEMS, normalizeNav, parseNavConfig, type NavConfigEntry } from "../nav";
import { img } from "../img";
import TagChip from "../components/TagChip";
import ChannelSearchPicker from "../components/ChannelSearchPicker";
import Tooltip from "../components/Tooltip";
import { PlaylistIconPicker } from "../components/PlaylistIcon";
import { TableSkeleton } from "../components/LoadingState";
import Popconfirm from "../components/Popconfirm";
import { emit } from "../events";
import { formatVideoCount, LANGUAGES, languageName, useI18n, type I18nKey, type Language } from "../i18n";
import { applyWatchedStyle, parseWatchedStyle, WATCHED_STYLES, type WatchedStyle } from "../watchedStyle";
import { VideoThumbnail } from "../components/VideoThumbnail";

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
        <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
        <span className="muted">{formatVideoCount(playlist.video_count, language)}</span>
        <button className="btn" onClick={save}>{t("save")}</button>
        <Popconfirm
          message={t("confirmDelete", { name: playlist.name })}
          onConfirm={() => api.deleteUserPlaylist(playlist.id).then(() => { reload(); emit("playlists-changed"); })}
        >
          <button className="icon-btn" title={t("deletePlaylist")}>
            <Trash2 />
          </button>
        </Popconfirm>
      </div>
      <div className="playlist-rules">
        <div className="form-row">
          <input
            type="text"
            placeholder={t("patternPlaceholder")}
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addRule()}
          />
          <select value={matchType} onChange={(e) => setMatchType(e.target.value)}>
            <option value="contains">{t("contains")}</option>
            <option value="regex">regex</option>
          </select>
          <select value={field} onChange={(e) => setField(e.target.value)}>
            <option value="title">{t("inTitle")}</option>
            <option value="description">{t("inDescription")}</option>
            <option value="both">{t("titleOrDescription")}</option>
          </select>
          <button className="btn primary" onClick={addRule}>
            <Plus /> {t("addRule")}
          </button>
          <button className="btn" onClick={applyRules}>
            <Zap /> {t("applyToDatabase")}
          </button>
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
                    <button className="icon-btn" title={t("delete")} onClick={() => api.removeUserPlaylistRule(playlist.id, r.id).then(reload)}>
                      <Trash2 />
                    </button>
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
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ width: 32, height: 32, padding: 2, border: "1px solid var(--surface-3)", borderRadius: 6, background: "var(--bg)", cursor: "pointer", flexShrink: 0 }} />
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} style={{ flex: 1, minWidth: 0 }} />
          </div>
        </td>
        <td className="muted">{formatVideoCount(tag.video_count ?? 0, language)} · {t("tagChannelCount", { n: tag.channel_count ?? 0 })}</td>
        <td className="shrink">
          <Tooltip text={t("filterOnlyHint")} pos="left">
            <button
              className="icon-btn"
              style={filterOnly ? { color: "var(--accent)" } : { opacity: 0.3 }}
              onClick={() => setFilterOnly(!filterOnly)}
            >
              <Filter size={15} />
            </button>
          </Tooltip>
        </td>
        <td className="shrink">
          <div style={{ display: "flex", gap: 4 }}>
            <button className="icon-btn" title={t("save")} onClick={save}><Check /></button>
            <button className="icon-btn" title={t("cancel")} onClick={() => { setName(tag.name); setColor(tag.color); setFilterOnly(!!tag.filter_only); setEditing(false); }}><X /></button>
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
          <button
            className="icon-btn"
            style={tag.filter_only ? { color: "var(--accent)" } : { opacity: 0.3 }}
            onClick={() => onSave({ filter_only: tag.filter_only ? 0 : 1 })}
          >
            <Filter size={15} />
          </button>
        </Tooltip>
      </td>
      <td className="shrink">
        <div style={{ display: "flex", gap: 4 }}>
          <button className="icon-btn" title={t("edit")} onClick={() => setEditing(true)}><Pencil /></button>
          <Popconfirm message={t("confirmDelete", { name: tag.name })} onConfirm={onRemove}>
            <button className="icon-btn" title={t("delete")}><Trash2 /></button>
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
            <input type="text" value={pattern} onChange={(e) => setPattern(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} style={{ flex: 1, minWidth: 120 }} />
            <select value={matchType} onChange={(e) => setMatchType(e.target.value as "contains" | "regex")}>
              <option value="contains">{t("contains")}</option>
              <option value="regex">regex</option>
            </select>
            <select value={field} onChange={(e) => setField(e.target.value as "title" | "description" | "both")}>
              <option value="title">{t("inTitle")}</option>
              <option value="description">{t("inDescription")}</option>
              <option value="both">{t("titleOrDescription")}</option>
            </select>
            <select value={tagId} onChange={(e) => setTagId(Number(e.target.value))}>
              {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button className="icon-btn" title={t("save")} onClick={save}><Check /></button>
            <button className="icon-btn" title={t("cancel")} onClick={() => setEditing(false)}><X /></button>
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
          <button className="icon-btn" title={t("edit")} onClick={() => setEditing(true)}><Pencil /></button>
          <button className="icon-btn" title={t("delete")} onClick={onRemove}><Trash2 /></button>
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
      <input
        type="text"
        className="plugin-text-input"
        placeholder={searchPlaceholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="plugin-multiselect-chips">
        {visible.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`plugin-term-chip${selected.has(option.value) ? " selected" : ""}`}
            onClick={(e) => { e.preventDefault(); toggle(option.value); }}
          >
            {selected.has(option.value) && <Check size={12} />}
            {option.label}
          </button>
        ))}
      </div>
    </div>
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
            <input type="text" value={pattern} onChange={(e) => setPattern(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} style={{ flex: 1, minWidth: 120 }} />
            <select value={matchType} onChange={(e) => setMatchType(e.target.value as "contains" | "regex")}>
              <option value="contains">{t("contains")}</option>
              <option value="regex">regex</option>
            </select>
            <select value={field} onChange={(e) => setField(e.target.value as "title" | "description" | "both")}>
              <option value="title">{t("inTitle")}</option>
              <option value="description">{t("inDescription")}</option>
              <option value="both">{t("titleOrDescription")}</option>
            </select>
            <select value={action} onChange={(e) => setAction(e.target.value as "reject" | "whitelist")}>
              <option value="reject">{t("rejectMatching")}</option>
              <option value="whitelist">{t("onlyMatching")}</option>
            </select>
            <select value={channelId} onChange={(e) => setChannelId(e.target.value)}>
              <option value="">{t("allChannels")}</option>
              {channels.filter(c => c.followed !== 0).map((c) => (
                <option key={c.channel_id} value={c.channel_id}>{c.title || c.channel_id}</option>
              ))}
            </select>
            <button className="icon-btn" title={t("save")} onClick={save}><Check /></button>
            <button className="icon-btn" title={t("cancel")} onClick={() => setEditing(false)}><X /></button>
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
          <button className="icon-btn" title={t("edit")} onClick={() => setEditing(true)}><Pencil /></button>
          <Popconfirm message={t("confirmDelete", { name: rule.pattern })} onConfirm={onRemove}>
            <button className="icon-btn" title={t("delete")}><Trash2 /></button>
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
          <div className="section-title" style={{ marginBottom: 8 }}>{group.label}</div>
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
              <div className="sidebar-order-divider"><span>{t("hiddenItems")}</span></div>
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
                <button className="icon-btn" title={t("moveUp")} disabled={i === 0} onClick={() => move(i, i - 1)}>
                  <ChevronUp size={15} />
                </button>
                <button className="icon-btn" title={t("moveDown")} disabled={i === value.length - 1} onClick={() => move(i, i + 1)}>
                  <ChevronDown size={15} />
                </button>
                <button className="icon-btn" title={entry.hidden ? t("showItem") : t("hideItem")} onClick={() => toggleHidden(entry.key)}>
                  {entry.hidden ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
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
                <button className="profile-avatar-remove-btn" aria-label={t("removeAvatar")}><X size={13} /></button>
              </Popconfirm>
            </div>
          )}
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={onAvatarFile} />
        </div>

        <div className="profile-name-field">
          <label className="switch-label">{t("profileName")}</label>
          <input className="form-input" value={name} placeholder={t("profileName")} onChange={(e) => setName(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === "Enter" && save()} />
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
              <input
                className="form-input"
                type="password"
                inputMode="numeric"
                maxLength={6}
                placeholder={t("pinPlaceholder")}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              />
              <button className="btn primary" onClick={savePin} disabled={pin.length > 0 && pin.length !== 6}>{t("save")}</button>
              <button className="btn" onClick={() => { setEditingPin(false); setPin(""); }}>{t("cancel")}</button>
            </>
          ) : profile.has_pin ? (
            <>
              <span className="profile-card-meta">{t("profilePin")}: ••••••</span>
              <button className="btn" onClick={() => setEditingPin(true)}>{t("changePin")}</button>
              <button className="btn" onClick={async () => { await api.updateProfile(profile.id, { pin: null }); onSaved(); }}>{t("removePin")}</button>
            </>
          ) : (
            <button className="btn" onClick={() => setEditingPin(true)}>{t("setPin")}</button>
          )}
        </div>
      )}

      {/* Child-profile flag: primary-only, and never on the primary itself. */}
      {allowChildToggle && (
        <div className="switch-row">
          <div>
            <div className="switch-label">{t("childProfile")}</div>
            <div className="switch-sub">{t("childProfileHint")}</div>
          </div>
          <button
            className={`switch${profile.is_child ? " on" : ""}`}
            role="switch"
            aria-checked={profile.is_child}
            onClick={async () => {
              await api.updateProfile(profile.id, { is_child: !profile.is_child });
              showToast(t("profileSaved"));
              onSaved();
            }}
          />
        </div>
      )}

      {allowChildToggle && profile.is_child && (
        <ChildProfileSettings profile={profile} onSaved={onSaved} showToast={showToast} />
      )}

      {/* Primary can clear (but not set) another profile's forgotten PIN. */}
      {allowPinReset && profile.has_pin && (
        <div className="profile-edit-row">
          <span className="profile-card-meta">{t("profilePin")}: ••••••</span>
          <Popconfirm message={t("resetPinConfirm")} onConfirm={async () => { await api.resetProfilePin(profile.id); showToast(t("profileSaved")); onSaved(); }}>
            <button className="btn">{t("resetPin")}</button>
          </Popconfirm>
        </div>
      )}

      {canDelete && (
        <div className="profile-edit-row">
          {!profile.has_pin ? (
            <Popconfirm message={t("deleteProfileConfirm")} onConfirm={async () => { await api.deleteProfile(profile.id); onDeleted(); }}>
              <button className="btn danger"><Trash2 size={15} /> {t("deleteProfile")}</button>
            </Popconfirm>
          ) : !profile.active ? (
            // PIN-protected: must be logged into it to delete.
            <span className="profile-card-meta">{t("switchToDeleteHint")}</span>
          ) : confirmingDelete ? (
            <>
              <input
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
              <button className="btn danger" onClick={deleteWithPin} disabled={deletePin.length !== 6}>{t("deleteProfile")}</button>
              <button className="btn" onClick={() => { setConfirmingDelete(false); setDeletePin(""); setDeleteError(false); }}>{t("cancel")}</button>
            </>
          ) : (
            <button className="btn danger" onClick={() => setConfirmingDelete(true)}><Trash2 size={15} /> {t("deleteProfile")}</button>
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
      <div className="switch-row">
        <div>
          <div className="switch-label">{t("childLimit")}</div>
          <div className="switch-sub">{t("childLimitHint")}</div>
        </div>
        <button
          className={`switch${cfg.limit_minutes > 0 ? " on" : ""}`}
          role="switch"
          aria-checked={cfg.limit_minutes > 0}
          onClick={() => save({ limit_minutes: cfg.limit_minutes > 0 ? 0 : parseInt(minutes, 10) || 60 })}
        />
      </div>
      {cfg.limit_minutes > 0 && (
        <div className="profile-edit-row">
          <label className="switch-label" style={{ margin: 0 }}>{t("childLimitMinutes")}</label>
          <input
            className="form-input"
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

      <div className="switch-row">
        <div>
          <div className="switch-label">{t("childLocalOnly")}</div>
          <div className="switch-sub">{t("childLocalOnlyHint")}</div>
        </div>
        <button
          className={`switch${cfg.local_only ? " on" : ""}`}
          role="switch"
          aria-checked={cfg.local_only}
          onClick={() => save({ local_only: !cfg.local_only })}
        />
      </div>

      <div className="switch-row">
        <div>
          <div className="switch-label">{t("childHideShorts")}</div>
          <div className="switch-sub">{t("childHideShortsHint")}</div>
        </div>
        <button
          className={`switch${cfg.hide_shorts ? " on" : ""}`}
          role="switch"
          aria-checked={cfg.hide_shorts}
          onClick={() => save({ hide_shorts: !cfg.hide_shorts })}
        />
      </div>

      <div className="switch-row">
        <div>
          <div className="switch-label">{t("childHideLive")}</div>
          <div className="switch-sub">{t("childHideLiveHint")}</div>
        </div>
        <button
          className={`switch${cfg.hide_live ? " on" : ""}`}
          role="switch"
          aria-checked={cfg.hide_live}
          onClick={() => save({ hide_live: !cfg.hide_live })}
        />
      </div>

      <div className="switch-row">
        <div>
          <div className="switch-label">{t("childDownloadsOnly")}</div>
          <div className="switch-sub">{t("childDownloadsOnlyHint")}</div>
        </div>
        <button
          className={`switch${cfg.downloads_only ? " on" : ""}`}
          role="switch"
          aria-checked={cfg.downloads_only}
          onClick={() => save({ downloads_only: !cfg.downloads_only })}
        />
      </div>

      {!childLockEnabled && (
        <p className="page-hint child-pin-warning">{t("childPinWarning")}</p>
      )}

      {profile.pin_locked && (
        <div className="profile-edit-row">
          <span className="profile-card-meta">{t("childPinLockedInfo")}</span>
          <button
            className="btn"
            onClick={async () => {
              await api.unlockChildProfile(profile.id);
              showToast(t("profileSaved"));
              onSaved();
            }}
          >{t("childUnlockProfile")}</button>
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
    <section className="settings-section">
      <p className="page-hint">{t("profilesHint")}</p>
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
                <button className="btn" onClick={() => setExpanded(expanded === p.id ? null : p.id)}>
                  <Pencil size={15} /> {t("edit")}
                </button>
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
            <input className="form-input" value={newName} placeholder={t("profileName")} autoFocus onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
            <div className="profile-color-swatches" style={{ marginTop: 8 }}>
              {PROFILE_COLORS.map((c) => (
                <button key={c} className={`profile-color-swatch${c === newColor ? " selected" : ""}`} style={{ background: c }} aria-label={c} onClick={() => setNewColor(c)} />
              ))}
            </div>
          </div>
          <div className="profile-card-actions">
            <button className="btn primary" onClick={create} disabled={!newName.trim()}>{t("create")}</button>
            <button className="btn" onClick={() => setCreating(false)}>{t("cancel")}</button>
          </div>
        </div>
      ) : (
        <button className="btn" onClick={() => setCreating(true)}><UserPlus size={15} /> {t("addProfile")}</button>
      )}
    </section>
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
    <section className="settings-section">
      <div className="switch-label">{t("assignChannelsTitle")}</div>
      <p className="hint">{t("assignChannelsHint")}</p>
      <div className="form-row">
        <select className="select" value={target} onChange={(e) => setTarget(e.target.value ? Number(e.target.value) : "")}>
          <option value="">{t("assignChannelsSelect")}</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <button className="btn primary" disabled={typeof target !== "number" || busy} onClick={assign}>
          {busy ? <LoaderCircle size={15} className="spin" /> : <Tv size={15} />}
          {t("assignChannelsButton")}
        </button>
      </div>
    </section>
  );
}

export default function SettingsPage({ showToast }: { showToast: (m: string) => void }) {
  const { t, language, setLanguage, locale } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (searchParams.get("tab") as Tab) ?? "channels";
  const setTab = (t: Tab) => setSearchParams({ tab: t }, { replace: true });
  const [channelSubTab, setChannelSubTab] = useState<"list" | "filters">("list");
  const [tagSubTab, setTagSubTab] = useState<"list" | "rules">("list");
  const [advancedSubTab, setAdvancedSubTab] = useState<"external" | "logs">("external");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [filterRules, setFilterRules] = useState<FilterRule[]>([]);
  const [playlists, setPlaylists] = useState<UserPlaylist[]>([]);
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
  const [appIconColor, setAppIconColor] = useState("#f2293a");
  // App-wide settings (app name, icon color, child lock) are owned by the
  // primary profile; other profiles see them read-only.
  const [isPrimary, setIsPrimary] = useState(true);
  const [isChildProfile, setIsChildProfile] = useState<boolean | null>(null);
  const [showShorts, setShowShorts] = useState(false);
  const [showTopChannels, setShowTopChannels] = useState(true);
  const [hideLiveFromFeed, setHideLiveFromFeed] = useState(false);
  const [watchedStyle, setWatchedStyle] = useState<WatchedStyle>("dimmed");
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
  const tagMenuRef = useRef<HTMLDivElement>(null);
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
  }, [tab, advancedSubTab, loadExternal, loadLogs]);

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
        setAppIconColor(r.settings.app_icon_color || "#f2293a");
        setShowShorts(r.settings.show_shorts === "1");
        setShowTopChannels(r.settings.show_top_channels !== "0");
        setHideLiveFromFeed(r.settings.hide_live_from_feed === "1");
        setWatchedStyle(parseWatchedStyle(r.settings.watched_style));
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

  useEffect(() => {
    if (!tagMenuChannelId) return;
    const close = (e: MouseEvent) => {
      if (!tagMenuRef.current?.contains(e.target as Node)) setTagMenuChannelId(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [tagMenuChannelId]);

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

  const changeWatchedStyle = async (next: WatchedStyle) => {
    setWatchedStyle(next);
    applyWatchedStyle(next);
    await api.updateSettings({ watched_style: next });
    emit("watched-style-changed");
    showToast(t("displaySettingsSaved"));
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
      <h1 className="page-title">{t("settingsTitle")}</h1>

      {childLock.enabled && !childLock.locked && (
        <button className="settings-unlocked-warning" onClick={lockSettings}>
          <ShieldCheck />
          <span>{t("settingsUnlockedWarning")}</span>
          <strong>{t("lockSettingsNow")}</strong>
        </button>
      )}

      <div className="settings-tabs">
        {visibleTabs.map((tabItem) => (
          <button
            key={tabItem.id}
            className={`settings-tab${tab === tabItem.id ? " active" : ""}`}
            onClick={() => setTab(tabItem.id)}
          >
            {tabItem.icon}
            {t(tabItem.labelKey)}
            {tabItem.id === "channels" && channels.length > 0 && (
              <span className="settings-tab-count">{channels.length}</span>
            )}
          </button>
        ))}
      </div>

      {isSettingsLocked && tab !== "tags" && tab !== "playlists" && (
        <section className="settings-section child-lock-panel">
          <div className="child-lock-header">
            <ShieldCheck />
            <div>
              <div className="switch-label">{t("settingsLockedTitle")}</div>
              <div className="child-lock-description">{t("settingsLockedHint")}</div>
            </div>
          </div>
          <div className="form-row">
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              placeholder={t("pinPlaceholder")}
              value={unlockPin}
              onChange={(e) => setUnlockPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              onKeyDown={(e) => e.key === "Enter" && unlockSettings()}
            />
            <button className="btn primary" onClick={unlockSettings} disabled={unlockPin.length !== 6}>
              <ShieldCheck /> {t("unlockSettings")}
            </button>
          </div>
        </section>
      )}

      {!isSettingsLocked && tab === "profiles" && isChildProfile === false && (
        <>
          <ProfilesSettings showToast={showToast} />

          <section className="settings-section child-lock-panel">
            <div className="child-lock-header">
              <ShieldCheck />
              <div>
                <div className="switch-label">{t("childLock")}</div>
                <div className="child-lock-description">{t("childLockHint")}</div>
              </div>
            </div>

            {!isPrimary ? (
              <p className="page-hint">{t("primaryOnlyHint")}</p>
            ) : !childLock.enabled ? (
              <>
                <p className="hint">{t("childLockEnableHint")}</p>
                <div className="form-row">
                  <input
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    placeholder={t("newPinPlaceholder")}
                    value={enablePin}
                    onChange={(e) => setEnablePin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  />
                  <input
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    placeholder={t("confirmPinPlaceholder")}
                    value={enablePinConfirm}
                    onChange={(e) => setEnablePinConfirm(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    onKeyDown={(e) => e.key === "Enter" && enableChildLock()}
                  />
                  <button className="btn primary" onClick={enableChildLock} disabled={enablePin.length !== 6 || enablePinConfirm.length !== 6}>
                    <ShieldCheck /> {t("enableChildLock")}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="child-lock-status">
                  <span className="tag-pill">{t("childLockEnabledStatus")}</span>
                  <button className="btn" onClick={lockSettings}>{t("lockNow")}</button>
                  <button className="btn danger" onClick={disableChildLock}>{t("disableChildLock")}</button>
                </div>
                <p className="hint">{t("changePinHint")}</p>
                <div className="form-row">
                  <input
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    placeholder={t("newPinPlaceholder")}
                    value={newPin}
                    onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  />
                  <input
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    placeholder={t("confirmPinPlaceholder")}
                    value={newPinConfirm}
                    onChange={(e) => setNewPinConfirm(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    onKeyDown={(e) => e.key === "Enter" && changeChildPin()}
                  />
                  <button className="btn primary" onClick={changeChildPin} disabled={newPin.length !== 6 || newPinConfirm.length !== 6}>
                    {t("changePin")}
                  </button>
                </div>
              </>
            )}
          </section>

          {isPrimary && <ChannelOwnership showToast={showToast} />}
        </>
      )}

      {!isSettingsLocked && tab === "auth" && isPrimary && <AuthSettings showToast={showToast} />}

      {!isSettingsLocked && tab === "channels" && (
        <section className="settings-section">
          <div className="settings-subtabs">
            <button className={`settings-subtab${channelSubTab === "list" ? " active" : ""}`} onClick={() => setChannelSubTab("list")}>
              {t("channels")}{channels.length > 0 && <span className="settings-tab-count">{channels.length}</span>}
            </button>
            <button className={`settings-subtab${channelSubTab === "filters" ? " active" : ""}`} onClick={() => setChannelSubTab("filters")}>
              {t("filters")}{filterRules.length > 0 && <span className="settings-tab-count">{filterRules.length}</span>}
            </button>
          </div>

          {channelSubTab === "list" && (
            <>
              <p className="hint">{t("addChannelHint")}</p>
              <div className="form-row">
                <input
                  type="text"
                  style={{ flex: 1, minWidth: 240 }}
                  placeholder={t("channelLinkPlaceholder")}
                  value={channelUrl}
                  disabled={addingChannel}
                  onChange={(e) => setChannelUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addChannel()}
                />
                <input
                  type="text"
                  style={{ width: 200 }}
                  placeholder={t("customNameOptional")}
                  value={channelCustomName}
                  disabled={addingChannel}
                  onChange={(e) => setChannelCustomName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addChannel()}
                />
                <button className="btn primary" onClick={addChannel} disabled={addingChannel || !channelUrl.trim()}>
                  {addingChannel ? <LoaderCircle className="spin" /> : <Plus />}
                  {addingChannel ? t("addingChannel") : t("addChannel")}
                </button>
                <ChannelSearchPicker onAdded={(name) => {
                  showToast(t("channelAdded", { name }));
                  load();
                }} />
                <button className="btn" onClick={() => fileRef.current?.click()} disabled={addingChannel}>
                  <FolderUp /> {t("importOpmlCsv")}
                </button>
                <input
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
                          <img className="ch-avatar" src={ch.thumbnail} alt="" />
                        ) : (
                          <div className="ch-avatar ch-avatar-fallback">
                            {(ch.title || ch.channel_id).charAt(0).toUpperCase()}
                          </div>
                        )}
                      </td>
                      <td>
                        {renamingChannelId === ch.channel_id ? (
                          <div className="channel-rename-row">
                            <input
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
                            <button className="btn-ghost" title={t("save")} onClick={() => saveRenameChannel(ch.channel_id, renameValue.trim() || null)}>
                              <Check size={14} />
                            </button>
                            {ch.custom_title && (
                              <button className="btn-ghost" title={t("revertToOriginalName")} onClick={() => saveRenameChannel(ch.channel_id, null)}>
                                <RotateCcw size={14} />
                              </button>
                            )}
                            <button className="btn-ghost" title={t("cancel")} onClick={() => setRenamingChannelId(null)}>
                              <X size={14} />
                            </button>
                          </div>
                        ) : (
                          <>
                            <span className="channel-name-wrap">
                              <Link to={`/channel/${ch.channel_id}`} className="channel-name channel-name-link">
                                {ch.title || ch.channel_id}
                              </Link>
                              <button className="btn-ghost channel-rename-btn" title={t("renameChannel")} onClick={() => startRenameChannel(ch)}>
                                <Pencil size={12} />
                              </button>
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
                        <div className="dropdown" ref={tagMenuChannelId === ch.channel_id ? tagMenuRef : undefined}>
                          <button
                            className="btn-ghost"
                            onClick={() => setTagMenuChannelId((prev) => (prev === ch.channel_id ? null : ch.channel_id))}
                            title={t("manageChannelTags")}
                          >
                            <Plus size={13} /> Tag
                          </button>
                          {tagMenuChannelId === ch.channel_id && (
                            <div className="dropdown-menu" style={{ minWidth: 220 }}>
                              {tags.map((tag) => {
                                const isSelected = ch.tags.some((ct) => ct.id === tag.id);
                                return (
                                  <button
                                    key={tag.id}
                                    className={isSelected ? "is-selected" : undefined}
                                    onClick={() => toggleChannelTag(ch.channel_id, tag)}
                                    title={isSelected ? t("removeTagFromChannel") : t("tagToChannel")}
                                  >
                                    <span className="dot" style={{ background: tag.color, width: 8, height: 8, borderRadius: "50%", display: "inline-block", flexShrink: 0 }} />
                                    {tag.name}
                                    {isSelected && (
                                      <span className="dropdown-menu-status" aria-label={t("selectedTag")}>
                                        <Check size={14} />
                                      </span>
                                    )}
                                  </button>
                                );
                              })}
                              <div style={{ borderTop: "1px solid var(--surface-3)", margin: "6px 0" }} />
                              <div style={{ padding: "6px 12px 10px", display: "flex", flexDirection: "column", gap: 8 }}>
                                <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.4px" }}>{t("newTag")}</div>
                                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                  <input
                                    type="color"
                                    value={newChannelTagColor}
                                    onChange={(e) => setNewChannelTagColor(e.target.value)}
                                    style={{ width: 32, height: 32, border: "1px solid var(--surface-3)", borderRadius: 6, background: "var(--bg)", padding: 2, cursor: "pointer", flexShrink: 0 }}
                                  />
                                  <input
                                    type="text"
                                    placeholder={t("tagNamePlaceholder")}
                                    value={newChannelTagName}
                                    onChange={(e) => setNewChannelTagName(e.target.value)}
                                    onKeyDown={(e) => e.key === "Enter" && createAndAddChannelTag(ch.channel_id)}
                                    style={{ flex: 1, background: "var(--bg)", border: "1px solid var(--surface-3)", borderRadius: 6, padding: "6px 10px", color: "var(--text)", fontSize: 13, outline: "none", minWidth: 0 }}
                                  />
                                </div>
                                <button
                                  className="btn primary"
                                  onClick={() => createAndAddChannelTag(ch.channel_id)}
                                  disabled={!newChannelTagName.trim()}
                                  style={{ width: "100%", justifyContent: "center" }}
                                >
                                  {t("addTag")}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="shrink">
                        <button
                          className={`btn${ch.followed === 0 ? " primary" : " danger"}`}
                          title={ch.followed === 0 ? t("followAgain") : t("unfollow")}
                          onClick={async () => {
                            await api.followChannel(ch.channel_id, ch.followed === 0);
                            load();
                          }}
                        >
                          {ch.followed === 0 ? <UserPlus size={15} /> : <UserMinus size={15} />}
                          {ch.followed === 0 ? t("follow") : t("unfollow")}
                        </button>
                      </td>
                      <td className="shrink">
                        <Popconfirm
                          message={t("confirmDelete", { name: ch.title })}
                          onConfirm={() => api.removeChannel(ch.channel_id).then(load)}
                        >
                          <button className="icon-btn" title={t("deleteChannel")}>
                            <Trash2 />
                          </button>
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

          {channelSubTab === "filters" && (
            <>
              <p className="hint">
                {t("filterHint")}
              </p>
              <div className="form-row" style={{ flexWrap: "wrap" }}>
                <input
                  type="text"
                  placeholder={t("patternPlaceholder")}
                  style={{ flex: 1, minWidth: 160 }}
                  value={filterPattern}
                  onChange={(e) => setFilterPattern(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addFilterRule()}
                />
                <select value={filterMatch} onChange={(e) => setFilterMatch(e.target.value)}>
                  <option value="contains">{t("contains")}</option>
                  <option value="regex">regex</option>
                </select>
                <select value={filterField} onChange={(e) => setFilterField(e.target.value)}>
                  <option value="title">{t("inTitle")}</option>
                  <option value="description">{t("inDescription")}</option>
                  <option value="both">{t("titleOrDescription")}</option>
                </select>
                <select value={filterAction} onChange={(e) => setFilterAction(e.target.value)}>
                  <option value="reject">{t("rejectMatching")}</option>
                  <option value="whitelist">{t("onlyMatching")}</option>
                </select>
                <select value={filterChannel} onChange={(e) => setFilterChannel(e.target.value)}>
                  <option value="">{t("allChannels")}</option>
                  {channels.filter(c => c.followed !== 0).map((c) => (
                    <option key={c.channel_id} value={c.channel_id}>{c.title || c.channel_id}</option>
                  ))}
                </select>
                <button className="btn primary" onClick={addFilterRule} disabled={!filterPattern.trim()}>
                  <Plus /> {t("addFilter")}
                </button>
              </div>
              {loading && filterRules.length === 0 ? (
                <TableSkeleton rows={5} columns={3} />
              ) : (
                <FilterRuleGroups rules={filterRules} channels={channels} onSave={async (id, patch) => { await api.updateFilterRule(id, patch); load(); }} onRemove={(id) => api.removeFilterRule(id).then(load)} />
              )}
              {!loading && filterRules.length === 0 && <div className="muted" style={{ paddingTop: 8 }}>{t("noFilterRules")}</div>}
            </>
          )}
        </section>
      )}

      {tab === "tags" && (
        <section className="settings-section">
          <div className="settings-subtabs">
            <button className={`settings-subtab${tagSubTab === "list" ? " active" : ""}`} onClick={() => setTagSubTab("list")}>
              {t("tags")}{tags.length > 0 && <span className="settings-tab-count">{tags.length}</span>}
            </button>
            <button className={`settings-subtab${tagSubTab === "rules" ? " active" : ""}`} onClick={() => setTagSubTab("rules")}>
              {t("rules")}{rules.length > 0 && <span className="settings-tab-count">{rules.length}</span>}
            </button>
          </div>

          {tagSubTab === "list" && (
            <>
              <p className="hint">
                {t("tagHint")}
              </p>
              <div className="form-row">
                <input
                  type="text"
                  placeholder={t("tagNameExample")}
                  value={tagName}
                  disabled={addingTag}
                  onChange={(e) => setTagName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addTag()}
                />
                <input type="color" value={tagColor} disabled={addingTag} onChange={(e) => setTagColor(e.target.value)} />
                <button className="btn primary" onClick={addTag} disabled={addingTag || !tagName.trim()}>
                  {addingTag ? <LoaderCircle className="spin" /> : <Plus />} {t("addTag")}
                </button>
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
              <p className="hint">
                {t("ruleHint")}
              </p>
              <div className="form-row">
                <input
                  type="text"
                  placeholder={t("patternPlaceholder")}
                  value={rulePattern}
                  onChange={(e) => setRulePattern(e.target.value)}
                />
                <select value={ruleMatch} onChange={(e) => setRuleMatch(e.target.value)}>
                  <option value="contains">{t("contains")}</option>
                  <option value="regex">regex</option>
                </select>
                <select value={ruleField} onChange={(e) => setRuleField(e.target.value)}>
                  <option value="title">{t("inTitle")}</option>
                  <option value="description">{t("inDescription")}</option>
                  <option value="both">{t("titleOrDescription")}</option>
                </select>
                <span className="muted">-&gt; tag:</span>
                <select value={ruleTag} onChange={(e) => setRuleTag(Number(e.target.value) || "")}>
                  <option value="">{t("chooseTag")}</option>
                  {tags.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                <button className="btn primary" onClick={addRule}>
                  <Plus /> {t("addRule")}
                </button>
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
        </section>
      )}

      {tab === "playlists" && (
        <section className="settings-section">
          <p className="hint">
            {t("playlistHint")}
          </p>
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
            <input
              type="text"
              placeholder={t("newPlaylistName")}
              value={playlistName}
              onChange={(e) => setPlaylistName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addPlaylist()}
            />
            <button className="btn primary" onClick={addPlaylist}>
              <Plus /> {t("newPlaylist")}
            </button>
          </div>
        </section>
      )}

      {!isSettingsLocked && tab === "display" && (
        <div className="settings-display-groups">
          <section className="settings-section settings-display-group">
            <h2>{t("displayAppearance")}</h2>
          {isPrimary ? (
            <>
              <div className="settings-select-row">
                <label className="switch-label" htmlFor="app-name">{t("appNameLabel")}</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    id="app-name"
                    type="text"
                    className="form-input"
                    style={{ flex: 1 }}
                    value={appNameInput}
                    placeholder={t("appNamePlaceholder")}
                    onChange={(e) => setAppNameInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveAppName()}
                  />
                  <button className="btn" onClick={saveAppName} disabled={appNameInput.trim() === appName}>{t("save")}</button>
                </div>
              </div>

              <div className="settings-select-row">
                <label className="switch-label" htmlFor="app-icon-color">{t("appIconColorLabel")}</label>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span className="logo-mark" style={{ background: appIconColor }}>
                    <Play fill="currentColor" size={16} />
                  </span>
                  <input
                    id="app-icon-color"
                    type="color"
                    value={appIconColor}
                    onChange={(e) => saveAppIconColor(e.target.value)}
                    style={{ width: 40, height: 32, padding: 2, border: "1px solid var(--surface-3)", borderRadius: 6, background: "var(--bg)", cursor: "pointer" }}
                  />
                </div>
              </div>
            </>
          ) : (
            <p className="page-hint">{t("primaryOnlyHint")}</p>
          )}
          </section>

          <section className="settings-section settings-display-group">
            <h2>{t("displayFeed")}</h2>
          <div className="switch-row">
            <div>
              <div className="switch-label">{t("showShorts")}</div>
              <div className="switch-sub">{t("showShortsHint")}</div>
            </div>
            <button
              className={`switch${showShorts ? " on" : ""}`}
              role="switch"
              aria-checked={showShorts}
              onClick={toggleShorts}
            />
          </div>

          <div className="switch-row">
            <div>
              <div className="switch-label">{t("hideLiveFromFeed")}</div>
              <div className="switch-sub">{t("hideLiveFromFeedHint")}</div>
            </div>
            <button
              className={`switch${hideLiveFromFeed ? " on" : ""}`}
              role="switch"
              aria-checked={hideLiveFromFeed}
              onClick={toggleLiveFromFeed}
            />
          </div>

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

          <div className="switch-row">
            <div>
              <div className="switch-label">{t("showTopChannels")}</div>
              <div className="switch-sub">{t("showTopChannelsHint")}</div>
            </div>
            <button
              className={`switch${showTopChannels ? " on" : ""}`}
              role="switch"
              aria-checked={showTopChannels}
              onClick={toggleTopChannels}
            />
          </div>

          </section>

          <section className="settings-section settings-display-group">
            <h2>{t("displayLanguage")}</h2>
          <div className="settings-select-row">
            <label className="switch-label" htmlFor="ui-language">{t("uiLanguage")}</label>
            <select
              id="ui-language"
              className="select"
              value={language}
              onChange={(e) => {
                const next = e.target.value as Language;
                setLanguage(next).then(() => showToast(t("displaySettingsSaved"))).catch(console.error);
              }}
            >
              {LANGUAGES.map((code) => (
                <option key={code} value={code}>{languageName(code)}</option>
              ))}
            </select>
          </div>
          </section>

          <section className="settings-section settings-display-group">
            <h2>{t("displayPlayback")}</h2>
          <div className="switch-row">
            <div>
              <div className="switch-label">{t("forceCaptions")}</div>
              <div className="switch-sub">{t("forceCaptionsHint")}</div>
            </div>
            <button
              className={`switch${playerCc ? " on" : ""}`}
              role="switch"
              aria-checked={playerCc}
              onClick={() => {
                const next = !playerCc;
                setPlayerCc(next);
                savePlayer({ player_cc: next ? "1" : "0" });
              }}
            />
          </div>
          <div className="settings-select-row">
            <label className="switch-label" htmlFor="player-language">{t("playerLanguage")}</label>
            <select
              id="player-language"
              className="select"
              value={playerHl}
              onChange={(e) => {
                setPlayerHl(e.target.value);
                savePlayer({ player_hl: e.target.value, player_cc_lang: e.target.value });
              }}
            >
              <option value="pl">polski</option>
              <option value="en">English</option>
              <option value="de">Deutsch</option>
              <option value="es">español</option>
              <option value="fr">français</option>
              <option value="uk">українська</option>
              <option value="ja">日本語</option>
            </select>
          </div>

          <div className="sub-style-panel">
            <div>
              <div className="switch-label">{t("subtitleStyleTitle")}</div>
              <div className="switch-sub">{t("subtitleStyleHint")}</div>
            </div>
            <div className="sub-style-controls">
              <label className="sub-style-field">
                <span>{t("subtitleSize")}</span>
                <div className="sub-size-input">
                  <input
                    type="number"
                    min={12}
                    max={48}
                    step={1}
                    value={subSize}
                    onChange={(e) => setSubSize(Math.min(48, Math.max(12, Number(e.target.value) || 12)))}
                    onBlur={() => savePlayer({ player_sub_size: String(subSize) })}
                  />
                  <span>px</span>
                </div>
              </label>
              <label className="sub-style-field">
                <span>{t("subtitleColor")}</span>
                <input
                  type="color"
                  value={subColor}
                  onChange={(e) => setSubColor(e.target.value)}
                  onBlur={(e) => savePlayer({ player_sub_color: e.target.value })}
                />
              </label>
              <label className="sub-style-field sub-style-field--wide">
                <span>{t("subtitleBackground")} ({subBg}%)</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={subBg}
                  style={{ background: `linear-gradient(to right, var(--accent) 0 ${subBg}%, var(--surface-3) ${subBg}% 100%)` }}
                  onChange={(e) => setSubBg(Number(e.target.value))}
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

          <div className="settings-select-row">
            <div>
              <label className="switch-label" htmlFor="player-quality">{t("quality")}</label>
              <div className="switch-sub">{t("qualityHint")}</div>
            </div>
            <select
              id="player-quality"
              className="select"
              value={playerQuality}
              onChange={(e) => {
                setPlayerQuality(e.target.value);
                savePlayer({ player_quality: e.target.value });
              }}
            >
              <option value="auto">{t("autoQuality")}</option>
              <option value="hd2160">4K (2160p)</option>
              <option value="hd1440">1440p</option>
              <option value="hd1080">1080p</option>
              <option value="hd720">720p</option>
              <option value="large">480p</option>
              <option value="medium">360p</option>
            </select>
          </div>

          <div className="settings-select-row">
            <div>
              <label className="switch-label" htmlFor="player-speed">{t("playbackSpeed")}</label>
              <div className="switch-sub">{t("playbackSpeedHint")}</div>
            </div>
            <select
              id="player-speed"
              className="select"
              value={playerSpeed}
              onChange={(e) => {
                setPlayerSpeed(e.target.value);
                savePlayer({ player_speed: e.target.value });
              }}
            >
              {PLAYBACK_SPEEDS.map((s) => (
                <option key={s} value={s}>{`${s}×`}</option>
              ))}
            </select>
          </div>

          <div className="settings-select-row">
            <div>
              <label className="switch-label" htmlFor="keyboard-seek-seconds">{t("keyboardSeekSeconds")}</label>
              <div className="switch-sub">{t("keyboardSeekSecondsHint")}</div>
            </div>
            <select
              id="keyboard-seek-seconds"
              className="select"
              value={keyboardSeekSeconds}
              onChange={(e) => {
                setKeyboardSeekSeconds(e.target.value);
                savePlayer({ keyboard_seek_seconds: e.target.value });
              }}
            >
              {[3, 5, 10, 15, 30].map((seconds) => (
                <option key={seconds} value={seconds}>{`${seconds} s`}</option>
              ))}
            </select>
          </div>

          <div className="switch-row">
            <div>
              <div className="switch-label">{t("autoFullscreenLandscape")}</div>
              <div className="switch-sub">{t("autoFullscreenLandscapeHint")}</div>
              <div className="switch-sub switch-sub--note">{t("autoFullscreenLandscapeCaveat")}</div>
            </div>
            <button
              className={`switch${autoFullscreen ? " on" : ""}`}
              role="switch"
              aria-checked={autoFullscreen}
              onClick={() => {
                const next = !autoFullscreen;
                setAutoFullscreen(next);
                savePlayer({ auto_fullscreen_landscape: next ? "1" : "0" });
              }}
            />
          </div>
          </section>

          <section className="settings-section settings-display-group">
            <h2>{t("displayEnhancements")}</h2>
          <div className="switch-row">
            <div>
              <div className="switch-label">SponsorBlock</div>
              <div className="switch-sub">{t("sponsorblockHint")}</div>
            </div>
            <button
              className={`switch${sbEnabled ? " on" : ""}`}
              role="switch"
              aria-checked={sbEnabled}
              onClick={toggleSb}
            />
          </div>

          {sbEnabled && (
            <div className="sb-category-grid">
              <div className="switch-sub" style={{ gridColumn: "1 / -1", marginBottom: 2 }}>{t("sponsorblockCategories")}</div>
              {SB_CATEGORIES.map((cat) => {
                const active = sbCategories.includes(cat.id);
                return (
                  <div key={cat.id} className="sb-category-row">
                    <span className="sb-category-dot" style={{ background: cat.color }} />
                    <span className="sb-category-name">{t(cat.labelKey)}</span>
                    <button
                      className={`switch${active ? " on" : ""}`}
                      role="switch"
                      aria-checked={active}
                      onClick={() => toggleSbCategory(cat.id)}
                    />
                  </div>
                );
              })}
            </div>
          )}
          </section>

          <section className="settings-section settings-display-group">
            <h2>{t("displayNavigation")}</h2>
          <div className="sidebar-order-head">
            <div>
              <div className="switch-label">{t("sidebarOrderTitle")}</div>
              <div className="switch-sub">{t("sidebarOrderHint")}</div>
            </div>
            <Popconfirm message={t("resetOrderConfirm")} onConfirm={resetNavConfig}>
              <button className="btn">{t("resetOrder")}</button>
            </Popconfirm>
          </div>
          <SidebarNavEditor value={navConfig} onChange={persistNavConfig} />
          </section>
        </div>
      )}

      {!isSettingsLocked && tab === "plugins" && (
        <section className="settings-section">
          <div className="plugin-alert">{t("pluginSettingsHint")}</div>
          <div className="plugin-settings-list">
            {plugins.map((plugin) => (
              <div key={plugin.id} className="plugin-settings-row">
                <div className="plugin-settings-main">
                  <div className="plugin-settings-name">{plugin.name}</div>
                  <div className="plugin-settings-description">{plugin.description}</div>
                  <div className="plugin-permissions">
                    {plugin.permissions.map((permission) => (
                      <span key={permission} className="tag-pill">{permission}</span>
                    ))}
                  </div>
                </div>
                <div className="plugin-settings-actions">
                  {pluginSettings[plugin.id]?.definitions.length > 0 && (
                    <button className="btn plugin-configure-btn" onClick={() => setPluginSettingsModalId(plugin.id)}>
                      <Wrench size={15} />
                      {t("configure")}
                    </button>
                  )}
                  <button
                    className={`switch ${plugin.enabled ? "on" : ""}`}
                    role="switch"
                    aria-checked={plugin.enabled}
                    onClick={() => togglePlugin(plugin)}
                  >
                    <span />
                  </button>
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
                keys: ["quality", "watch_source_mode", "thumb_progress", "download_scheduled", "download_feed", "feed_max_age_hours", "download_shorts"],
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
                    <button className="icon-btn plugin-modal-close" title={t("close")} onClick={() => setPluginSettingsModalId(null)}>
                      <X />
                    </button>
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
                              <label key={def.key} className={`plugin-slider-row${def.type === "multiselect" ? " plugin-slider-row--stacked" : ""}`}>
                                <div className="plugin-slider-copy">
                                  <span className="switch-label">{def.label}</span>
                                  <span className="switch-sub">{def.description}</span>
                                </div>
                                {def.type === "toggle" ? (
                                  <button
                                    type="button"
                                    className={`switch ${Number(value) === 1 ? "on" : ""}`}
                                    role="switch"
                                    aria-checked={Number(value) === 1}
                                    onClick={(e) => {
                                      // preventDefault stops the wrapping <label> from re-dispatching
                                      // a second synthetic click that would toggle right back.
                                      e.preventDefault();
                                      updatePluginSetting(plugin.id, def.key, Number(value) === 1 ? 0 : 1);
                                    }}
                                  >
                                    <span />
                                  </button>
                                ) : def.type === "multiselect" ? (
                                  <PluginMultiselect
                                    value={String(value)}
                                    options={def.options ?? []}
                                    searchPlaceholder={t("searchLanguagePlaceholder")}
                                    onChange={(next) => updatePluginSetting(plugin.id, def.key, next)}
                                  />
                                ) : def.type === "text" ? (
                                  <input
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
                                  <select
                                    className="plugin-select"
                                    value={String(value)}
                                    onChange={(e) => updatePluginSetting(plugin.id, def.key, e.target.value)}
                                  >
                                    {def.options?.map((option) => (
                                      <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                  </select>
                                ) : (
                                  <div className="plugin-slider-control">
                                    <input type="range" min={def.min} max={def.max} step={def.step} value={Number(value)} onChange={(e) => updatePluginSetting(plugin.id, def.key, Number(e.target.value))} />
                                    <input type="number" min={def.min} max={def.max} step={def.step} value={Number(value)} onChange={(e) => updatePluginSetting(plugin.id, def.key, Number(e.target.value))} />
                                  </div>
                                )}
                              </label>
                            );
                          })}
                        </div>
                      </section>
                    ))}
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
                      <button className="btn danger plugin-reset-btn" disabled={resettingPluginId === plugin.id}>
                        {resettingPluginId === plugin.id ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}
                        {t("pluginResetAction")}
                      </button>
                    </Popconfirm>
                  </div>
                </div>
              </div>,
              document.body
            );
          })()}
        </section>
      )}

      {!isSettingsLocked && tab === "advanced" && (
        <section className="settings-section">
          <div className="settings-subtabs">
            <button className={`settings-subtab${advancedSubTab === "external" ? " active" : ""}`} onClick={() => setAdvancedSubTab("external")}>
              {t("navExternal")}{externalVideos.length > 0 && <span className="settings-tab-count">{externalVideos.length}</span>}
            </button>
            <button className={`settings-subtab${advancedSubTab === "logs" ? " active" : ""}`} onClick={() => setAdvancedSubTab("logs")}>
              {t("logs")}
            </button>
          </div>

          {advancedSubTab === "external" && (
            <>
              <div className="page-head" style={{ marginBottom: 16 }}>
                <p className="page-hint" style={{ margin: 0 }}>{t("externalHint")}</p>
            {externalVideos.length > 0 && (
              <button className="btn danger" onClick={clearExternal} disabled={clearingExternal}>
                {clearingExternal ? <LoaderCircle size={15} className="spin" /> : <Trash2 size={15} />}
                {t("externalClear")}
              </button>
            )}
          </div>
          {loadingExternal && externalVideos.length === 0 ? (
            <TableSkeleton />
          ) : externalVideos.length === 0 ? (
            <div className="empty-state">
              <Clock />
              <div>{t("externalEmpty")}</div>
            </div>
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
                      <button
                        className="btn primary"
                        onClick={() => followExternalChannel(ch.channel_id)}
                        style={{ marginLeft: "auto", flexShrink: 0 }}
                      >
                        <UserPlus size={14} />
                        {t("follow")}
                      </button>
                      <button
                        className="btn danger"
                        onClick={() => removeExternalChannel(ch.channel_id)}
                        style={{ flexShrink: 0 }}
                      >
                        <Trash2 size={14} />
                        {t("externalClearChannel")}
                      </button>
                    </div>
                    <div className="external-video-list">
                      {ch.videos.map((v) => (
                        <div key={v.video_id} className="external-video-row">
                          <Link to={`/watch/${v.video_id}`} className="external-thumb-link" aria-label={v.title}>
                            <VideoThumbnail src={img(v.thumbnail)} watched={v.watched === 1} variant="external" loading="lazy" />
                          </Link>
                          <Link to={`/watch/${v.video_id}`} className="external-title-cell">
                            {v.title}
                          </Link>
                          <button
                            className="icon-btn danger"
                            title={t("delete")}
                            onClick={() => removeExternal(v.video_id)}
                          >
                            <Trash2 size={15} />
                          </button>
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
              <div className="page-head" style={{ marginBottom: 16 }}>
                <p className="page-hint" style={{ margin: 0 }}>{t("logsHint")}</p>
            <button className="btn" onClick={loadLogs} disabled={loadingLogs}>
              {loadingLogs ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}
              {t("refresh")}
            </button>
          </div>
          {logs && (
            <div className="logs-build-alert">
              <Info size={16} />
              <span>{t("logsReportHint")}</span>
              <code>{logs.version} ({logs.commit})</code>
            </div>
          )}
          {loadingLogs && !logs ? (
            <TableSkeleton rows={8} columns={1} />
          ) : !logs || logs.lines.length === 0 ? (
            <div className="empty-state">
              <FileText />
              <div>{t("logsEmpty")}</div>
            </div>
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
        </section>
      )}
    </>
  );
}
