import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp, Eye, EyeOff, Filter, GripVertical, ListMusic, LoaderCircle, Pencil, Plus, Trash2, Tv, X, Zap } from "lucide-react";
import { api, type Channel, type FilterRule, type Profile, type Rule, type Tag, type UserPlaylist, type UserPlaylistRule } from "../../api";
import { emit } from "../../events";
import { formatVideoCount, useI18n } from "../../i18n";
import { NAV_ITEMS, normalizeNav, type NavConfigEntry } from "../../nav";
import ChannelSearchPicker from "../ChannelSearchPicker";
import { PlaylistIconPicker } from "../PlaylistIcon";
import Popconfirm from "../Popconfirm";
import TagChip from "../TagChip";
import TagPickerMenu from "../TagPickerMenu";
import Tooltip from "../Tooltip";
import { Badge, Button, Checkbox, Chip, ColorPicker, Divider, Field, IconButton, Inline, Input, Popover, SectionHeader, SelectMenu, SettingsSection, Switch, Text } from "../ui";

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
