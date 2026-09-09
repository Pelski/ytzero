import { useCallback, useEffect, useState } from "react";
import { Film, Link2, ListMusic, ListVideo, LoaderCircle } from "lucide-react";
import { api, type ManagedPublicShare, type PublicShareResourceType } from "../../api";
import { useI18n } from "../../i18n";
import { Alert, Badge, Button, Dialog, EmptyState, Inline, List, ListRow, SettingRow, SettingsSection, Switch, Text } from "../ui";
import { PublicShareEditor, publicShareStatusLabel } from "../PublicShareControl";

const resourceLabels: Record<PublicShareResourceType, "publicShareVideo" | "publicShareUserPlaylist" | "publicShareFollowedPlaylist"> = {
  video: "publicShareVideo",
  user_playlist: "publicShareUserPlaylist",
  followed_playlist: "publicShareFollowedPlaylist",
};

export default function PublicSharingSettings() {
  const { t } = useI18n();
  const [policy, setPolicy] = useState<{ enabled: boolean; can_manage: boolean } | null>(null);
  const [shares, setShares] = useState<ManagedPublicShare[]>([]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await api.publicShares();
      setPolicy(result.policy);
      setShares(result.shares);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const changePolicy = async (enabled: boolean) => {
    if (!policy?.can_manage) return;
    setWorking(true);
    try {
      const result = await api.updatePublicSharingPolicy(enabled);
      setPolicy(result.policy);
      await load();
    } catch {
      setError(true);
    } finally {
      setWorking(false);
    }
  };

  const replace = (id: string, updated: ManagedPublicShare) => setShares((current) => current.map((share) => share.id === id ? updated : share));
  const remove = (id: string) => setShares((current) => current.filter((share) => share.id !== id));
  const selected = shares.find((share) => share.id === selectedId) ?? null;

  if (!policy && !error) return <SettingsSection><div className="public-sharing-settings__loading"><LoaderCircle className="spin" />{t("loading")}</div></SettingsSection>;

  return <div className="public-sharing-settings">
    <SettingsSection title={t("publicSharingTitle")}>
      {policy?.can_manage && <SettingRow label={t("publicSharingMaster")} description={t("publicSharingMasterHint")}>
        <Switch checked={policy.enabled} disabled={working} ariaLabel={t("publicSharingMaster")} onCheckedChange={(enabled) => void changePolicy(enabled)} />
      </SettingRow>}
      {policy && !policy.enabled && <Alert variant="warning">{t("publicShareDisabledByAdmin")}</Alert>}
      {error && <Alert variant="danger">{t("publicShareError")}</Alert>}
    </SettingsSection>
    <SettingsSection title={t("publicSharingLinks")} description={t("publicSharingLinksHint")}>
      {shares.length === 0 ? <EmptyState compact icon={<Link2 />} title={t("publicSharingEmpty")} description={t("publicSharingEmptyHint")} /> : <List className="public-sharing-settings__list">
        {shares.map((share) => <ListRow
          key={share.id}
          className="public-sharing-settings__row"
          media={<span className="public-sharing-settings__resource-icon">{share.resource_type === "video" ? <Film /> : share.resource_type === "user_playlist" ? <ListVideo /> : <ListMusic />}</span>}
          title={share.resource_title}
          description={<>{t(resourceLabels[share.resource_type])}{share.owner_name ? ` · ${t("publicShareOwner", { name: share.owner_name })}` : ""}</>}
          meta={<Badge size="sm" variant={share.active ? "success" : "warning"}>{publicShareStatusLabel(share, t)}</Badge>}
          actions={<Button size="sm" leadingIcon={<Link2 />} onClick={() => setSelectedId(share.id)}>{t("publicShareAction")}</Button>}
        />)}
      </List>}
    </SettingsSection>
    {selected && <Dialog open onOpenChange={(open) => { if (!open) setSelectedId(null); }} title={selected.resource_title} closeLabel={t("close")} className="public-sharing-settings__dialog">
      <Inline justify="between" align="start" className="public-sharing-settings__dialog-meta">
        <Text tone="secondary" size="sm">{t(resourceLabels[selected.resource_type])}{selected.owner_name ? ` · ${t("publicShareOwner", { name: selected.owner_name })}` : ""}</Text>
        <Badge size="sm" variant={selected.active ? "success" : "warning"}>{publicShareStatusLabel(selected, t)}</Badge>
      </Inline>
      <PublicShareEditor
        share={selected}
        pending={working}
        settingsLayout
        showStatus={false}
        onChange={(updated) => replace(selected.id, updated)}
        onDelete={() => { remove(selected.id); setSelectedId(null); }}
      />
    </Dialog>}
  </div>;
}
