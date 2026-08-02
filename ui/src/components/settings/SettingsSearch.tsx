import { useMemo, useState } from "react";
import { ArrowRight, Search, X } from "lucide-react";
import type { I18nKey } from "../../i18n";
import type { PluginManifest, PluginSettingsResponse } from "../../api";
import { EmptyState, IconButton, Input, InputGroup, List, ListButton, Popover, type SettingsNavGroup } from "../ui";
import { filterSettingsSearchEntries, staticSettingsSearchEntries, type SettingsSearchEntry } from "./settingsSearchModel";
import "./SettingsSearch.css";

export function SettingsSearch({
  groups,
  pluginSettings,
  plugins,
  t,
  onNavigate,
  onOpenPlugin,
}: {
  groups: SettingsNavGroup<string>[];
  pluginSettings: Record<string, PluginSettingsResponse>;
  plugins: PluginManifest[];
  t: (key: I18nKey) => string;
  onNavigate: (view: string) => void;
  onOpenPlugin: (pluginId: string, settingKey?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const entries = useMemo(() => {
    const navEntries = groups.flatMap((group) => group.items.map((item) => ({
      id: `section:${item.value}`,
      view: item.value,
      label: String(item.label),
      section: String(group.label),
    })));
    const sectionLabels = new Map(navEntries.map((entry) => [entry.view, entry.label]));
    const pluginEntries: SettingsSearchEntry[] = sectionLabels.has("plugins") ? plugins.flatMap((plugin) => [
      { id: `plugin:${plugin.id}`, view: "plugins", label: plugin.name, description: plugin.description, section: String(sectionLabels.get("plugins")), pluginId: plugin.id },
      ...(pluginSettings[plugin.id]?.definitions ?? []).map((definition) => ({ id: `plugin:${plugin.id}:${definition.key}`, view: "plugins", label: definition.label, description: definition.description, section: plugin.name, pluginId: plugin.id, settingKey: definition.key })),
    ]) : [];
    return [...navEntries, ...staticSettingsSearchEntries(t, sectionLabels), ...pluginEntries];
  }, [groups, pluginSettings, plugins, t]);
  const results = useMemo(() => filterSettingsSearchEntries(entries, query), [entries, query]);

  const select = (entry: SettingsSearchEntry) => {
    onNavigate(entry.view);
    if (entry.pluginId) onOpenPlugin(entry.pluginId, entry.settingKey);
    setOpen(false);
    setQuery("");
  };

  return <Popover
    rootClassName="settings-search"
    className="settings-search__popover"
    align="end"
    open={open && Boolean(query)}
    onOpenChange={setOpen}
    trigger={<div className="settings-search__field" onFocus={() => setOpen(true)} onClick={(event) => event.preventDefault()}>
      <InputGroup suffix={query ? <IconButton size="sm" label={t("clearSearch")} onClick={() => setQuery("")}><X /></IconButton> : undefined}>
        <Input
          value={query}
          placeholder={`${t("search")}…`}
          aria-label={`${t("search")} — ${t("settingsTitle")}`}
          aria-expanded={open && Boolean(query)}
          role="searchbox"
          onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
          onKeyDown={(event) => { if (event.key === "Enter" && results[0]) select(results[0]); }}
        />
      </InputGroup>
    </div>}
  >
    {query && (results.length > 0 ? <List className="settings-search__results">
      {results.map((entry) => <ListButton
        key={entry.id}
        title={entry.label}
        description={entry.description}
        meta={<span className="settings-search__meta">{entry.section}<ArrowRight size={15} /></span>}
        onClick={() => select(entry)}
      />)}
    </List> : <EmptyState compact icon={<Search />} title={t("settingsSearchNoResults")} />)}
  </Popover>;
}
