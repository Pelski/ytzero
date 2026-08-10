import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Archive, ArrowDownToLine, BookmarkPlus, Check, ChevronDown, ChevronUp, Clock, Eye, EyeOff, Filter, GripHorizontal, GripVertical, ListMusic, LoaderCircle, Lock, Pencil, Plus, Trash2, Tv, Undo2, X, Zap } from "lucide-react";
import { api, type Channel, type FilterRule, type Profile, type Rule, type Tag, type UserPlaylist, type UserPlaylistRule, type Video } from "../../api";
import { emit } from "../../events";
import { formatVideoCount, useI18n, type I18nKey } from "../../i18n";
import { NAV_ITEMS, normalizeNav, type NavConfigEntry } from "../../nav";
import { LOCKED_VIDEO_CARD_ACTION_IDS, type VideoCardActionConfig, type VideoCardActionId } from "../../videoCardActionConfig";
import type { VideoCardActionsMode } from "../../videoCardActions";
import ChannelSearchPicker from "../ChannelSearchPicker";
import { PlaylistIconPicker } from "../PlaylistIcon";
import Popconfirm from "../Popconfirm";
import TagChip from "../TagChip";
import TagPickerMenu from "../TagPickerMenu";
import Tooltip from "../Tooltip";
import VideoCard from "../VideoCard";
import { Badge, Button, Checkbox, Chip, ColorPicker, Divider, Field, IconButton, Inline, Input, Popover, SectionHeader, SelectMenu, SettingsSection, Switch, Text } from "../ui";
import "./SettingsEditors.css";

export function PlaylistSettingsItem({
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

export function TagRow({ tag, onSave, onRemove }: { tag: Tag; onSave: (p: { name?: string; color?: string; filter_only?: number }) => Promise<void>; onRemove: () => void }) {
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

export function RuleRow({ rule, tags, onSave, onRemove }: { rule: Rule; tags: Tag[]; onSave: (p: { tag_id?: number; pattern?: string; match_type?: string; field?: string }) => Promise<void>; onRemove: () => void }) {
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
export function PluginMultiselect({ value, options, searchPlaceholder, onChange, disabled = false }: {
  value: string;
  options: { value: string; label: string }[];
  searchPlaceholder: string;
  onChange: (next: string) => void;
  disabled?: boolean;
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
        disabled={disabled}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="plugin-multiselect-chips">
        {visible.map((option) => (
          <Chip
            key={option.value}
            type="button"
            active={selected.has(option.value)}
            disabled={disabled}
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

export function FilterRuleGroups({ rules, channels, onSave, onRemove }: {
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

export function SidebarNavEditor({ value, onChange, excludedKeys = new Set<string>() }: { value: NavConfigEntry[]; onChange: (next: NavConfigEntry[]) => void; excludedKeys?: ReadonlySet<string> }) {
  const { t } = useI18n();
  const [dragKey, setDragKey] = useState<string | null>(null);
  const byKey = new Map(NAV_ITEMS.map((i) => [i.to, i] as const));
  const displayedValue = value.filter((entry) => !excludedKeys.has(entry.key));
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
    if (to < 0 || to >= displayedValue.length || from === to) return;
    const fromKey = displayedValue[from]?.key;
    const toKey = displayedValue[to]?.key;
    const actualFrom = value.findIndex((entry) => entry.key === fromKey);
    const actualTo = value.findIndex((entry) => entry.key === toKey);
    if (actualFrom < 0 || actualTo < 0) return;
    const next = value.slice();
    const [moved] = next.splice(actualFrom, 1);
    next.splice(actualTo, 0, moved);
    onChange(next);
  };

  const toggleHidden = (key: string) =>
    onChange(value.map((v) => (v.key === key ? { ...v, hidden: !v.hidden } : v)));

  const firstHidden = displayedValue.findIndex((e) => e.hidden);

  return (
    <div className={`sidebar-order-list${dragKey ? " is-dragging" : ""}`}>
      {displayedValue.map((entry, i) => {
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
                const from = displayedValue.findIndex((v) => v.key === dragKey);
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
                <IconButton label={t("moveDown")} disabled={i === displayedValue.length - 1} onClick={() => move(i, i + 1)}>
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

const VIDEO_CARD_ACTION_ITEMS: Record<VideoCardActionId, { labelKey: I18nKey; icon: typeof Clock }> = {
  schedule: { labelKey: "watchLater", icon: Clock },
  playlist: { labelKey: "addToPlaylist", icon: BookmarkPlus },
  download: { labelKey: "downloadLocally", icon: ArrowDownToLine },
  archive: { labelKey: "reject", icon: Archive },
  watched: { labelKey: "markWatched", icon: Eye },
  restore: { labelKey: "restore", icon: Undo2 },
  remove: { labelKey: "remove", icon: Trash2 },
};

const VIDEO_CARD_PREVIEW: Video = {
  video_id: "settings-preview", channel_id: "settings-preview", title: "YT Zero — Video preview", description: "", thumbnail: "",
  published_at: "2026-08-10T12:00:00Z", found_at: "2026-08-10 12:00:00", published_at_approximate: 0,
  members_only: 0, is_private: 0, live_status: "none", status: "inbox", bucket: null, show_from: null, is_short: 0,
  views: null, likes: null, duration: "12:34", watch_position: null, watch_duration: null, in_history: 0,
  liked: 0, watched: 0, channel_title: "YT Zero", channel_thumbnail: null, channel_subscriber_count: null,
  downloads_enabled: true, downloads_allowed: true, tags: [],
};

export function VideoCardActionEditor({ value, mode, onChange }: { value: VideoCardActionConfig; mode: VideoCardActionsMode; onChange: (next: VideoCardActionConfig) => void }) {
  const { t } = useI18n();
  const [showContextualActions, setShowContextualActions] = useState(true);
  const [dragId, setDragId] = useState<VideoCardActionId | null>(null);
  const [pointerDrag, setPointerDrag] = useState<{ id: VideoCardActionId; source: "preview" | "tray"; x: number; y: number; startX: number; startY: number; offsetX: number; offsetY: number; width: number; height: number; moved: boolean } | null>(null);
  const pointerDragRef = useRef(pointerDrag);
  const suppressClickRef = useRef(false);
  const laneRef = useRef<HTMLDivElement>(null);
  const trayRef = useRef<HTMLDivElement>(null);
  const previewItemRefs = useRef(new Map<VideoCardActionId, HTMLButtonElement>());
  const trayItemRefs = useRef(new Map<VideoCardActionId, HTMLButtonElement>());
  const previewItemLefts = useRef(new Map<VideoCardActionId, number>());
  const trayItemTops = useRef(new Map<VideoCardActionId, number>());
  const previewItemAnimations = useRef(new Map<VideoCardActionId, Animation>());
  const trayItemAnimations = useRef(new Map<VideoCardActionId, Animation>());
  const visibleActions = value.actions.filter((action) => !action.hidden);
  const hiddenActions = value.actions.filter((action) => action.hidden);
  const previewConfig = showContextualActions ? value : { ...value, actions: value.actions.map((action) => action.id === "restore" || action.id === "remove" ? { ...action, hidden: true } : action) };

  useLayoutEffect(() => {
    previewItemRefs.current.forEach((element, id) => {
      const previous = previewItemLefts.current.get(id);
      const left = element.offsetLeft;
      previewItemLefts.current.set(id, left);
      if (previous === undefined || id === dragId || previous === left) return;
      previewItemAnimations.current.get(id)?.cancel();
      previewItemAnimations.current.set(id, element.animate([{ transform: `translateX(${previous - left}px)` }, { transform: "translateX(0)" }], { duration: 150, easing: "cubic-bezier(.2, 0, 0, 1)" }));
    });
    trayItemRefs.current.forEach((element, id) => {
      const previous = trayItemTops.current.get(id);
      const top = element.offsetTop;
      trayItemTops.current.set(id, top);
      if (previous === undefined || id === dragId || previous === top) return;
      trayItemAnimations.current.get(id)?.cancel();
      trayItemAnimations.current.set(id, element.animate([{ transform: `translateY(${previous - top}px)` }, { transform: "translateY(0)" }], { duration: 150, easing: "cubic-bezier(.2, 0, 0, 1)" }));
    });
  });

  const placeVisible = (id: VideoCardActionId, index: number) => {
    if (id === "schedule") return;
    const dragged = value.actions.find((action) => action.id === id);
    if (!dragged) return;
    const visible = visibleActions.filter((action) => action.id !== id);
    visible.splice(Math.min(Math.max(1, index), visible.length), 0, { ...dragged, hidden: false });
    const actions = [...visible, ...hiddenActions.filter((action) => action.id !== id)];
    if (actions.some((action, actionIndex) => action.id !== value.actions[actionIndex]?.id || action.hidden !== value.actions[actionIndex]?.hidden)) onChange({ version: 1, actions });
  };

  const hide = (id: VideoCardActionId) => {
    if (LOCKED_VIDEO_CARD_ACTION_IDS.has(id)) { setDragId(null); return; }
    const action = value.actions.find((entry) => entry.id === id);
    if (action) onChange({ version: 1, actions: [...value.actions.filter((entry) => entry.id !== id), { ...action, hidden: true }] });
    setDragId(null);
  };

  const placeInTray = (id: VideoCardActionId, index: number) => {
    const action = value.actions.find((entry) => entry.id === id);
    if (!action || id === "schedule") return;
    const trayActions = value.actions.filter((entry) => entry.id !== "schedule" && entry.id !== id);
    trayActions.splice(Math.min(Math.max(0, index), trayActions.length), 0, action);
    const actions = [value.actions.find((entry) => entry.id === "schedule")!, ...trayActions];
    if (actions.some((entry, actionIndex) => entry.id !== value.actions[actionIndex]?.id)) onChange({ version: 1, actions });
  };

  const setActiveDrag = (next: typeof pointerDrag) => { pointerDragRef.current = next; setPointerDrag(next); };
  const beginPointerDrag = (event: ReactPointerEvent<HTMLButtonElement>, id: VideoCardActionId, source: "preview" | "tray") => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragId(id);
    setActiveDrag({ id, source, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top, width: rect.width, height: rect.height, moved: false });
  };
  const movePointerDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = pointerDragRef.current;
    if (!current) return;
    const moved = current.moved || Math.hypot(event.clientX - current.startX, event.clientY - current.startY) > 4;
    setActiveDrag({ ...current, x: event.clientX, y: event.clientY, moved });
    if (!moved) return;
    const lane = laneRef.current?.getBoundingClientRect();
    if (lane && event.clientX >= lane.left - 12 && event.clientX <= lane.right + 12 && event.clientY >= lane.top - 16 && event.clientY <= lane.bottom + 16) {
      const candidates = visibleActions.filter((action) => action.id !== current.id && action.id !== "schedule");
      const target = candidates.findIndex((action) => event.clientX < (previewItemRefs.current.get(action.id)?.getBoundingClientRect().left ?? Infinity) + (previewItemRefs.current.get(action.id)?.offsetWidth ?? 0) / 2);
      placeVisible(current.id, target < 0 ? candidates.length + 1 : target + 1);
      return;
    }
    const tray = trayRef.current?.getBoundingClientRect();
    if (current.source !== "tray" || !tray || event.clientX < tray.left || event.clientX > tray.right || event.clientY < tray.top || event.clientY > tray.bottom) return;
    const candidates = value.actions.filter((action) => action.id !== "schedule" && action.id !== current.id);
    const target = candidates.findIndex((action) => event.clientY < (trayItemRefs.current.get(action.id)?.getBoundingClientRect().top ?? Infinity) + (trayItemRefs.current.get(action.id)?.offsetHeight ?? 0) / 2);
    placeInTray(current.id, target < 0 ? candidates.length : target);
  };
  const endPointerDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = pointerDragRef.current;
    if (!current) return;
    const tray = trayRef.current?.getBoundingClientRect();
    if (current.source === "preview" && current.moved && tray && event.clientX >= tray.left && event.clientX <= tray.right && event.clientY >= tray.top && event.clientY <= tray.bottom) hide(current.id);
    suppressClickRef.current = current.moved;
    setDragId(null);
    setActiveDrag(null);
  };
  const consumeDragClick = () => { if (!suppressClickRef.current) return false; suppressClickRef.current = false; return true; };

  const renderPreviewAction = (id: Exclude<VideoCardActionId, "schedule">) => {
    const item = VIDEO_CARD_ACTION_ITEMS[id];
    const ItemIcon = item.icon;
    return <button
      type="button"
      key={id}
      className={`action-btn video-card-action-preview__button${dragId === id && pointerDrag?.source === "preview" ? " is-source" : ""}`}
      title={LOCKED_VIDEO_CARD_ACTION_IDS.has(id) ? t(item.labelKey) : `${t(item.labelKey)} — ${t("hideItem")}`}
      ref={(element) => { if (element) previewItemRefs.current.set(id, element); else previewItemRefs.current.delete(id); }}
      onPointerDown={(event) => beginPointerDrag(event, id, "preview")}
      onPointerMove={movePointerDrag}
      onPointerUp={endPointerDrag}
      onPointerCancel={endPointerDrag}
      onClick={() => { if (!consumeDragClick() && !LOCKED_VIDEO_CARD_ACTION_IDS.has(id)) hide(id); }}
    ><ItemIcon /></button>;
  };

  return <div className={`video-card-action-editor${dragId ? " is-dragging" : ""}`}>
    <Switch
      className="video-card-action-preview-toggle"
      checked={showContextualActions}
      onCheckedChange={setShowContextualActions}
      label={t("contextActionsPreview")}
    />
    <div ref={laneRef} className="video-card-action-preview-shell" aria-label={t("videoCardActionsLabel")}>
      <VideoCard
        video={VIDEO_CARD_PREVIEW}
        onPlay={() => {}}
        onChanged={() => {}}
        readOnly
        processing={false}
        actionPreview={{ config: previewConfig, mode, renderAction: renderPreviewAction }}
      />
    </div>

    <div ref={trayRef} className={`video-card-action-tray${dragId ? " is-active" : ""}`}>
      <div className="video-card-action-tray__title">{t("videoCardActionsLabel")}</div>
      <div className="video-card-action-tray__items">
        {value.actions.filter((action) => action.id !== "schedule").map((action) => {
          const item = VIDEO_CARD_ACTION_ITEMS[action.id];
          const Icon = item.icon;
          return <button
            type="button"
            key={action.id}
            className={`video-card-action-tray__item${action.hidden ? "" : " is-used"}${LOCKED_VIDEO_CARD_ACTION_IDS.has(action.id) ? " is-locked" : ""}${dragId === action.id && pointerDrag?.source === "tray" ? " is-source" : ""}`}
            title={LOCKED_VIDEO_CARD_ACTION_IDS.has(action.id) ? t(item.labelKey) : `${t(item.labelKey)} — ${action.hidden ? t("showItem") : t("hideItem")}`}
            ref={(element) => { if (element) trayItemRefs.current.set(action.id, element); else trayItemRefs.current.delete(action.id); }}
            onPointerDown={(event) => beginPointerDrag(event, action.id, "tray")}
            onPointerMove={movePointerDrag}
            onPointerUp={endPointerDrag}
            onPointerCancel={endPointerDrag}
            onClick={() => { if (!consumeDragClick() && !LOCKED_VIDEO_CARD_ACTION_IDS.has(action.id)) action.hidden ? placeVisible(action.id, visibleActions.length) : hide(action.id); }}
          ><span className="video-card-action-tray__grip"><GripHorizontal size={13} /></span><Icon size={16} /><span className="video-card-action-tray__name">{t(item.labelKey)}</span><span className="video-card-action-tray__state">{LOCKED_VIDEO_CARD_ACTION_IDS.has(action.id) ? <Lock size={12} /> : action.hidden ? <EyeOff size={12} /> : <Eye size={12} />}</span></button>;
        })}
      </div>
    </div>
    {pointerDrag && pointerDrag.moved && createPortal(<div className={`video-card-action-drag-layer is-${pointerDrag.source}`} style={{ height: pointerDrag.height, left: pointerDrag.x - pointerDrag.offsetX, top: pointerDrag.y - pointerDrag.offsetY, width: pointerDrag.width }}>
      {(() => { const item = VIDEO_CARD_ACTION_ITEMS[pointerDrag.id]; const DragIcon = item.icon; return <>{pointerDrag.source === "tray" && <GripHorizontal size={13} />}<DragIcon size={pointerDrag.source === "preview" ? 14 : 16} />{pointerDrag.source === "tray" && <span>{t(item.labelKey)}</span>}</>; })()}
    </div>, document.body)}
  </div>;
}

// Admin-only: claim every existing channel for one profile (ownership migration
// for installs that had channels before auth). See POST /channels/assign-all.
export function ChannelOwnership({ showToast }: { showToast: (m: string) => void }) {
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
