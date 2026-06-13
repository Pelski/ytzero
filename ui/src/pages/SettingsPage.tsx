import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Check, FolderUp, LoaderCircle, ListMusic, MonitorPlay, Pencil, Plus, ShieldCheck, Tags, Trash2, Tv, UserMinus, UserPlus, X, Zap } from "lucide-react";
import { api, type Channel, type ChildLockStatus, type FilterRule, type Rule, type Tag, type UserPlaylist, type UserPlaylistRule, SB_CATEGORIES } from "../api";
import TagChip from "../components/TagChip";
import { PlaylistIconPicker } from "../components/PlaylistIcon";
import { TableSkeleton } from "../components/LoadingState";
import Popconfirm from "../components/Popconfirm";
import { emit } from "../events";
import { formatVideoCount, useI18n, type I18nKey, type Language } from "../i18n";

type Tab = "channels" | "tags" | "playlists" | "display" | "child";

const TABS: { id: Tab; labelKey: I18nKey; icon: React.ReactNode }[] = [
  { id: "channels", labelKey: "channels", icon: <Tv size={15} /> },
  { id: "tags", labelKey: "tagsRules", icon: <Tags size={15} /> },
  { id: "playlists", labelKey: "playlists", icon: <ListMusic size={15} /> },
  { id: "display", labelKey: "display", icon: <MonitorPlay size={15} /> },
  { id: "child", labelKey: "child", icon: <ShieldCheck size={15} /> },
];

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
    showToast(language === "pl" ? `Reguła dodana — dodano ${r.matched} istniejących filmów` : `Rule added - added ${r.matched} existing videos`);
    setPattern("");
    reload();
  };

  const applyRules = async () => {
    const r = await api.applyUserPlaylistRules(playlist.id);
    showToast(language === "pl" ? `Zastosowano reguły — dopasowano ${r.matched} filmów` : `Rules applied - matched ${r.matched} videos`);
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
          message={language === "pl" ? `Usunąć „${playlist.name}"?` : `Delete "${playlist.name}"?`}
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
            <Zap /> {language === "pl" ? "Zastosuj do bazy" : "Apply to database"}
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

function TagRow({ tag, onSave, onRemove }: { tag: Tag; onSave: (p: { name?: string; color?: string }) => Promise<void>; onRemove: () => void }) {
  const { t, language } = useI18n();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState(tag.color);

  const save = async () => {
    await onSave({ name, color });
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
        <td className="muted">{formatVideoCount(tag.video_count ?? 0, language)} · {language === "pl" ? `${tag.channel_count ?? 0} kanałów` : `${tag.channel_count ?? 0} channels`}</td>
        <td className="shrink">
          <div style={{ display: "flex", gap: 4 }}>
            <button className="icon-btn" title={t("save")} onClick={save}><Check /></button>
            <button className="icon-btn" title={t("cancel")} onClick={() => { setName(tag.name); setColor(tag.color); setEditing(false); }}><X /></button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td><TagChip tag={{ ...tag, name, color }} /></td>
      <td className="muted">{formatVideoCount(tag.video_count ?? 0, language)} · {language === "pl" ? `${tag.channel_count ?? 0} kanałów` : `${tag.channel_count ?? 0} channels`}</td>
      <td className="shrink">
        <div style={{ display: "flex", gap: 4 }}>
          <button className="icon-btn" title={t("edit")} onClick={() => setEditing(true)}><Pencil /></button>
          <Popconfirm message={language === "pl" ? `Usunąć tag „${tag.name}"?` : `Delete tag "${tag.name}"?`} onConfirm={onRemove}>
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

function FilterRuleRow({ rule, channels, onSave, onRemove }: { rule: FilterRule; channels: Channel[]; onSave: (p: Parameters<typeof api.updateFilterRule>[1]) => Promise<void>; onRemove: () => void }) {
  const { t, language } = useI18n();
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
          <Popconfirm message={language === "pl" ? `Usunąć filtr „${rule.pattern}"?` : `Delete filter "${rule.pattern}"?`} onConfirm={onRemove}>
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

export default function SettingsPage({ showToast }: { showToast: (m: string) => void }) {
  const { t, language, setLanguage } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (searchParams.get("tab") as Tab) ?? "channels";
  const setTab = (t: Tab) => setSearchParams({ tab: t }, { replace: true });
  const [channelSubTab, setChannelSubTab] = useState<"list" | "filters">("list");
  const [tagSubTab, setTagSubTab] = useState<"list" | "rules">("list");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [filterRules, setFilterRules] = useState<FilterRule[]>([]);
  const [playlists, setPlaylists] = useState<UserPlaylist[]>([]);
  const [playlistRules, setPlaylistRules] = useState<Record<number, UserPlaylistRule[]>>({});
  const [loading, setLoading] = useState(true);
  const [addingChannel, setAddingChannel] = useState(false);

  const [channelUrl, setChannelUrl] = useState("");
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
  const [showShorts, setShowShorts] = useState(false);
  const [playerHl, setPlayerHl] = useState("pl");
  const [playerCc, setPlayerCc] = useState(false);
  const [playerQuality, setPlayerQuality] = useState("auto");
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

  useEffect(() => {
    load().catch(console.error);
    Promise.all([api.settings(), api.childLock()])
      .then(([r, cl]) => {
        setShowShorts(r.settings.show_shorts === "1");
        setPlayerHl(r.settings.player_hl);
        setPlayerCc(r.settings.player_cc === "1");
        setPlayerQuality(r.settings.player_quality);
        setSbEnabled(r.settings.sponsorblock_enabled === "1");
        try { setSbCategories(JSON.parse(r.settings.sponsorblock_categories || '["sponsor"]')); } catch {}
        setChildLock(cl.child_lock);
      })
      .catch(console.error);
  }, [load]);

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
      const r = await api.addChannel(channelUrl.trim());
      showToast(language === "pl" ? `Dodano kanał: ${r.title || r.channel_id}` : `Added channel: ${r.title || r.channel_id}`);
      setChannelUrl("");
      await load();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      showToast(message === "HTTP 500" ? t("addChannelNotFoundError") : `${language === "pl" ? "Błąd" : "Error"}: ${message}`);
    } finally {
      setAddingChannel(false);
    }
  };

  const importFile = async (file: File) => {
    try {
      const r = await api.importFile(file);
      showToast(language === "pl" ? `Znaleziono ${r.found} kanałów, dodano ${r.added} nowych. Pobieranie filmów w tle...` : `Found ${r.found} channels, added ${r.added} new. Fetching videos in the background...`);
      load();
    } catch (e) {
      showToast(`${language === "pl" ? "Błąd importu" : "Import error"}: ${e instanceof Error ? e.message : e}`);
    }
  };

  const addTag = async () => {
    if (!tagName.trim()) return;
    await api.addTag(tagName.trim(), tagColor);
    setTagName("");
    load();
    emit("tags-changed");
  };

  const addRule = async () => {
    if (!ruleTag || !rulePattern.trim()) return;
    const r = await api.addRule({
      tag_id: Number(ruleTag),
      pattern: rulePattern.trim(),
      match_type: ruleMatch,
      field: ruleField,
    });
    showToast(language === "pl" ? `Reguła dodana — otagowano ${r.matched} istniejących filmów` : `Rule added - tagged ${r.matched} existing videos`);
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
    showToast(language === "pl" ? `Reguła dodana — odrzucono ${r.archived} filmów` : `Rule added - rejected ${r.archived} videos`);
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

  return (
    <>
      <h1 className="page-title">{t("settingsTitle")}</h1>

      <div className="settings-tabs">
        {TABS.map((tabItem) => (
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

      {isSettingsLocked && (
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
              <p className="hint">
                {language === "pl"
                  ? "Dodaj kanał po linku (np. https://www.youtube.com/@nazwa) albo zaimportuj subskrypcje - OPML lub subscriptions.csv z Google Takeout."
                  : "Add a channel by link (for example https://www.youtube.com/@name) or import subscriptions from OPML or subscriptions.csv from Google Takeout."}
              </p>
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
                <button className="btn primary" onClick={addChannel} disabled={addingChannel || !channelUrl.trim()}>
                  {addingChannel ? <LoaderCircle className="spin" /> : <Plus />}
                  {addingChannel ? t("addingChannel") : t("addChannel")}
                </button>
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
                <table className="list-table">
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
                        <Link to={`/channel/${ch.channel_id}`} className="channel-name channel-name-link">
                          {ch.title || ch.channel_id}
                        </Link>
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
                          message={language === "pl" ? `Usunąć kanał „${ch.title}"?` : `Delete channel "${ch.title}"?`}
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

      {!isSettingsLocked && tab === "tags" && (
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
                  onChange={(e) => setTagName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addTag()}
                />
                <input type="color" value={tagColor} onChange={(e) => setTagColor(e.target.value)} />
                <button className="btn primary" onClick={addTag}>
                  <Plus /> {t("addTag")}
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

      {!isSettingsLocked && tab === "playlists" && (
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
        <section className="settings-section">
          <div className="switch-row">
            <div>
              <div className="switch-label">{t("showShorts")}</div>
              <div className="switch-sub">
                {t("showShortsHint")}
              </div>
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
              <option value="en">English</option>
              <option value="pl">polski</option>
            </select>
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

          <div className="settings-select-row">
            <label className="switch-label" htmlFor="player-quality">{t("quality")}</label>
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
          <p className="hint" style={{ marginTop: 4 }}>
            {t("qualityHint")}
          </p>

          <hr className="section-divider" />

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
                    <span className="sb-category-name">{cat.label[language]}</span>
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
      )}

      {!isSettingsLocked && tab === "child" && (
        <section className="settings-section child-lock-panel">
          <div className="child-lock-header">
            <ShieldCheck />
            <div>
              <div className="switch-label">{t("childLock")}</div>
              <div className="child-lock-description">{t("childLockHint")}</div>
            </div>
          </div>

          {!childLock.enabled ? (
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
      )}
    </>
  );
}
