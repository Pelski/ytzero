import { useCallback, useEffect, useMemo, useState } from "react";
import { Hash, ListVideo, LoaderCircle, Tv } from "lucide-react";
import { api, type NotificationCategory, type NotificationPreferences, type NotificationSourceType } from "../../api";
import { useI18n, type I18nKey } from "../../i18n";
import { img } from "../../img";
import { Alert, Button, Divider, Field, FormActions, Input, List, ListRow, SettingRow, SettingsSection, Switch, Textarea } from "../ui";
import NotificationSourceSelect, { type NotificationSourceMode } from "../NotificationSourceSelect";
import "./NotificationSettings.css";

const CATEGORY_ROWS: Array<{ kind: NotificationCategory; label: I18nKey; description: I18nKey }> = [
  { kind: "channel_video", label: "notificationChannelUploads", description: "notificationChannelUploadsHint" },
  { kind: "playlist_video", label: "notificationPlaylistUpdates", description: "notificationPlaylistUpdatesHint" },
  { kind: "tag_rule", label: "notificationTagRules", description: "notificationTagRulesHint" },
  { kind: "download_failed", label: "notificationDownloadFailures", description: "notificationDownloadFailuresHint" },
  { kind: "social", label: "notificationSocialActivity", description: "notificationSocialActivityHint" },
  { kind: "app_update", label: "notificationAppUpdates", description: "notificationAppUpdatesHint" },
];

const RULE_FIELD_LABELS: Record<string, I18nKey> = {
  title: "notificationRuleFieldTitle",
  description: "notificationRuleFieldDescription",
  both: "notificationRuleFieldBoth",
};

function sourceMode(enabled: number | null): NotificationSourceMode {
  return enabled === null ? "default" : enabled === 1 ? "on" : "off";
}

function modeValue(mode: NotificationSourceMode): boolean | null {
  return mode === "default" ? null : mode === "on";
}

function currentPublicBaseUrl(): string {
  return typeof window === "undefined" ? "" : window.location.origin;
}

export default function NotificationSettings() {
  const { t } = useI18n();
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState("");
  const [search, setSearch] = useState("");
  const [targets, setTargets] = useState("");
  const [providerUrl, setProviderUrl] = useState("");
  const [publicBaseUrl, setPublicBaseUrl] = useState("");
  const [deliveryNotice, setDeliveryNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const next = await api.notificationPreferences();
      setPreferences(next);
      setTargets(next.delivery.targets);
      setProviderUrl(next.delivery.provider === "ntfy" ? next.delivery.ntfyServerUrl : next.delivery.appriseServerUrl);
      setPublicBaseUrl(next.delivery.publicBaseUrl || (next.delivery.canConfigureProvider ? currentPublicBaseUrl() : ""));
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const updateProfile = async (input: Parameters<typeof api.updateNotificationPreferences>[0], key: string) => {
    if (!preferences || pending) return;
    setPending(key);
    const previous = preferences;
    setPreferences({
      ...preferences,
      enabled: input.enabled ?? preferences.enabled,
      categories: { ...preferences.categories, ...input.categories },
    });
    try { await api.updateNotificationPreferences(input); setError(""); }
    catch (reason) { setPreferences(previous); setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setPending(""); }
  };

  const updateSource = async (sourceType: NotificationSourceType, sourceId: string, mode: NotificationSourceMode) => {
    if (!preferences || pending) return;
    const key = `${sourceType}:${sourceId}`;
    setPending(key);
    try { await api.updateNotificationSource(sourceType, sourceId, modeValue(mode)); setError(""); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setPending(""); }
  };

  const updateDelivery = async (input: Parameters<typeof api.updateNotificationDelivery>[0], key: string) => {
    if (!preferences || pending) return;
    setPending(key);
    setDeliveryNotice("");
    try {
      const delivery = await api.updateNotificationDelivery(input);
      setPreferences((current) => current && { ...current, delivery });
      setTargets(delivery.targets);
      if (delivery.canConfigureProvider) {
        setProviderUrl(delivery.provider === "ntfy" ? delivery.ntfyServerUrl : delivery.appriseServerUrl);
        setPublicBaseUrl(delivery.publicBaseUrl || currentPublicBaseUrl());
      }
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setPending(""); }
  };

  const sendTest = async () => {
    setPending("delivery-test");
    setDeliveryNotice("");
    try { await api.testNotificationDelivery(); setDeliveryNotice(t("notificationDeliveryTestSent")); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setPending(""); }
  };

  const needle = search.trim().toLowerCase();
  const matches = useCallback((...values: string[]) => !needle || values.some((value) => value.toLowerCase().includes(needle)), [needle]);
  const channels = useMemo(() => (preferences?.channels ?? []).filter((channel) => matches(channel.title)), [preferences, matches]);
  const playlists = useMemo(() => (preferences?.playlists ?? []).filter((playlist) => matches(playlist.title, playlist.channel_title)), [preferences, matches]);
  const rules = useMemo(() => (preferences?.rules ?? []).filter((rule) => matches(rule.tag_name, rule.pattern)), [preferences, matches]);

  if (!preferences && !error) return <SettingsSection><div className="notification-settings__loading"><LoaderCircle className="spin" />{t("loading")}</div></SettingsSection>;

  const delivery = preferences?.delivery;
  const deliveryBusy = Boolean(pending);
  const targetsHint = delivery?.provider === "apprise" ? t("notificationDeliveryAppriseHint")
    : delivery?.provider === "ntfy" ? t("notificationDeliveryNtfyHint")
    : t("notificationDeliveryWebhookHint");

  return <div className="notification-settings">
    {error && <Alert variant="danger" title={t("error")}>{error}{!preferences && <div><Button size="sm" onClick={() => void load()}>{t("reload")}</Button></div>}</Alert>}
    {preferences && <>
      <SettingsSection title={t("notificationProfileControl")} description={t("notificationProfileControlHint")}>
        <SettingRow label={t("notificationMasterSwitch")} description={t("notificationMasterSwitchHint")}>
          <Switch checked={preferences.enabled} disabled={pending === "master"} onCheckedChange={(enabled) => void updateProfile({ enabled }, "master")} />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={t("notificationCategories")} description={t("notificationCategoriesHint")}>
        {CATEGORY_ROWS.map((category) => <SettingRow key={category.kind} label={t(category.label)} description={t(category.description)}>
          <Switch checked={preferences.categories[category.kind]} disabled={Boolean(pending)} onCheckedChange={(enabled) => void updateProfile({ categories: { [category.kind]: enabled } }, category.kind)} />
        </SettingRow>)}
      </SettingsSection>

      {delivery && <SettingsSection title={t("notificationDelivery")} description={t("notificationDeliveryHint")}>
        {!delivery.pluginEnabled || delivery.provider === "off"
          ? <Alert variant="info">{t("notificationDeliveryDisabled")}</Alert>
          : <>
            {deliveryNotice && <Alert variant="success">{deliveryNotice}</Alert>}
            {!delivery.providerConfigured && <Alert variant="warning">{t("notificationDeliveryUnconfigured")}</Alert>}
            {!delivery.publicBaseUrlConfigured && <Alert variant="warning">{t("notificationDeliveryNoLinkWarning")}</Alert>}
            <SettingRow label={t("notificationDeliveryProvider")} description={t("notificationDeliveryHint")}>
              <span className="notification-settings__provider">{delivery.provider}</span>
            </SettingRow>
            {delivery.canConfigureProvider && delivery.provider !== "webhook" && <SettingRow
              align="start"
              label={delivery.provider === "apprise" ? t("notificationDeliveryAppriseServer") : t("notificationDeliveryNtfyServer")}
              description={delivery.provider === "apprise" ? t("notificationDeliveryAppriseServerHint") : t("notificationDeliveryNtfyServerHint")}
            >
              <Field>
                <Input
                  type="url"
                  className="notification-settings__url"
                  aria-label={delivery.provider === "apprise" ? t("notificationDeliveryAppriseServer") : t("notificationDeliveryNtfyServer")}
                  placeholder={delivery.provider === "apprise" ? "http://apprise:8000" : "https://ntfy.sh"}
                  value={providerUrl}
                  disabled={deliveryBusy}
                  onChange={(event) => setProviderUrl(event.target.value)}
                  onBlur={() => {
                    const stored = delivery.provider === "apprise" ? delivery.appriseServerUrl : delivery.ntfyServerUrl;
                    if (providerUrl !== stored) void updateDelivery(delivery.provider === "apprise" ? { appriseServerUrl: providerUrl } : { ntfyServerUrl: providerUrl }, "delivery-provider-url");
                  }}
                />
              </Field>
            </SettingRow>}
            {delivery.canConfigureProvider && <SettingRow align="start" label={t("notificationDeliveryPublicAddress")} description={t("notificationDeliveryPublicAddressHint")}>
              <Field>
                <Input
                  type="url"
                  className="notification-settings__url"
                  aria-label={t("notificationDeliveryPublicAddress")}
                  placeholder="https://ytzero.example.com"
                  value={publicBaseUrl}
                  disabled={deliveryBusy}
                  onChange={(event) => setPublicBaseUrl(event.target.value)}
                  onBlur={() => { if (publicBaseUrl !== delivery.publicBaseUrl) void updateDelivery({ publicBaseUrl }, "delivery-public-url"); }}
                />
              </Field>
            </SettingRow>}
            <SettingRow label={t("notificationDeliveryEnable")} description={t("notificationDeliveryEnableHint")}>
              <Switch checked={delivery.enabled} disabled={deliveryBusy} onCheckedChange={(enabled) => void updateDelivery({ enabled }, "delivery-enabled")} />
            </SettingRow>
            <SettingRow align="start" label={t("notificationDeliveryTargets")} description={`${t("notificationDeliveryTargetsHint")} ${targetsHint}`}>
              <Field>
                <Textarea
                  aria-label={t("notificationDeliveryTargets")}
                  className="notification-settings__targets"
                  rows={4}
                  spellCheck={false}
                  value={targets}
                  disabled={deliveryBusy}
                  onChange={(event) => setTargets(event.target.value)}
                  onBlur={() => { if (targets !== delivery.targets) void updateDelivery({ targets }, "delivery-targets"); }}
                />
              </Field>
            </SettingRow>
            <FormActions>
              <Button disabled={deliveryBusy || !delivery.providerConfigured || !delivery.enabled || !delivery.targets.trim()} onClick={() => void sendTest()}>
                {pending === "delivery-test" ? "…" : t("notificationDeliveryTest")}
              </Button>
            </FormActions>
          </>}
      </SettingsSection>}

      <SettingsSection collapsible title={t("notificationSourceOverrides")} description={t("notificationSourceOverridesHint")}>
        <Field className="notification-settings__search">
          <Input
            type="search"
            aria-label={t("notificationSourceSearch")}
            placeholder={t("notificationSearchPlaceholder")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </Field>

        <div className="notification-settings__group">
          <h3>{t("notificationChannelList")}</h3>
          <p>{t("notificationChannelListHint")}</p>
          {channels.length === 0 ? <p className="notification-settings__empty">{t("notificationChannelsEmpty")}</p> : <List>
            {channels.map((channel) => <ListRow
              key={channel.channel_id}
              media={channel.thumbnail
                ? <img className="notification-settings__avatar" src={img(channel.thumbnail)} alt="" />
                : <span className="notification-settings__icon"><Tv /></span>}
              title={channel.title}
              actions={<NotificationSourceSelect
                mode={sourceMode(channel.notification_enabled)}
                defaultEnabled={preferences.categories.channel_video}
                label={channel.title}
                disabled={Boolean(pending)}
                onChange={(mode) => void updateSource("channel", channel.channel_id, mode)}
              />}
            />)}
          </List>}
        </div>

        <Divider />

        <div className="notification-settings__group">
          <h3>{t("notificationPlaylistList")}</h3>
          <p>{t("notificationPlaylistListHint")}</p>
          {playlists.length === 0 ? <p className="notification-settings__empty">{t("notificationPlaylistsEmpty")}</p> : <List>
            {playlists.map((playlist) => <ListRow
              key={playlist.playlist_id}
              media={playlist.thumbnail
                ? <img className="notification-settings__thumbnail" src={img(playlist.thumbnail)} alt="" />
                : <span className="notification-settings__icon"><ListVideo /></span>}
              title={playlist.title}
              description={playlist.channel_title}
              actions={<NotificationSourceSelect
                mode={sourceMode(playlist.notification_enabled)}
                defaultEnabled={preferences.categories.playlist_video}
                label={playlist.title}
                disabled={Boolean(pending)}
                onChange={(mode) => void updateSource("playlist", playlist.playlist_id, mode)}
              />}
            />)}
          </List>}
        </div>

        <Divider />

        <div className="notification-settings__group">
          <h3>{t("notificationRuleList")}</h3>
          <p>{t("notificationRuleListHint")}</p>
          {rules.length === 0 ? <p className="notification-settings__empty">{t("notificationRulesEmpty")}</p> : <List>
            {rules.map((rule) => <ListRow
              key={rule.rule_id}
              media={<span className="notification-settings__icon" style={{ color: rule.tag_color }}><Hash /></span>}
              title={rule.tag_name}
              description={t(rule.match_type === "regex" ? "notificationRuleSummaryRegex" : "notificationRuleSummary", {
                field: t(RULE_FIELD_LABELS[rule.field] ?? "notificationRuleFieldTitle"),
                pattern: rule.pattern,
              })}
              actions={<NotificationSourceSelect
                mode={sourceMode(rule.notification_enabled)}
                defaultEnabled={preferences.categories.tag_rule}
                label={rule.tag_name}
                disabled={Boolean(pending)}
                onChange={(mode) => void updateSource("tag_rule", String(rule.rule_id), mode)}
              />}
            />)}
          </List>}
        </div>
      </SettingsSection>

    </>}
  </div>;
}
