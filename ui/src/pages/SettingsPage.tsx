import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import "./SettingsPage.css";
import { useSettingsPageController } from "./useSettingsPageController";
import { SettingsDisplayView } from "../components/settings/SettingsDisplayView";
import { createPortal } from "react-dom";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, ArchiveRestore, ArrowRight, Check, CheckCircle2, ChevronDown, ChevronUp, Clock, Download, ExternalLink, Eye, EyeOff, FileText, Filter, FolderUp, GripVertical, Info, LoaderCircle, Pencil, Play, Plug, Plus, RefreshCw, RotateCcw, ShieldCheck, Sparkles, Trash2, Tv, UserMinus, UserPlus, UsersRound, Wrench, X, Zap } from "lucide-react";
import { api, type AppChangelog, type AppLogs, type AppLogStreamEvent, type AppVersion, type AuthMethod, type Channel, type ChannelManualStatus, type ChildLockStatus, type FilterRule, type MembersOnlyVisibility, type PluginManifest, type PluginSettingsResponse, type Profile, type ProfilePermissionArea, type ProfilePermissions, type Rule, type Tag, type UpdateCheck, type UserPlaylist, type UserPlaylistRule, type Video, SB_CATEGORIES, PLAYBACK_SPEEDS } from "../api";
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
import { formatAgeUnit, LANGUAGES, languageName, useI18n, type I18nKey } from "../i18n";
import { useDocumentTitle } from "../useDocumentTitle";
import { applyWatchedStyle, parseWatchedStyle, WATCHED_STYLES, type WatchedStyle } from "../watchedStyle";
import { VideoThumbnail, watchProgress } from "../components/VideoThumbnail";
import { applyVideoCardSize, parseVideoCardSize, persistVideoCardSize, VIDEO_CARD_SIZE_MAX, VIDEO_CARD_SIZE_MIN } from "../videoCardSize";
import { Alert, Badge, Button, ButtonAnchor, ButtonLink, Chip, ColorPicker, Dialog, Divider, EmptyState, Field, FormActions, IconButton, Inline, Input, InputGroup, PageHeader, Popover, RevealList, SectionHeader, SelectMenu, SettingRow, SettingsNav, SettingsSection, Slider, Switch, Text, type SettingsNavGroup } from "../components/ui";
import { DEFAULT_SCREENSHOT_FILENAME_TEMPLATE, parsePlayerScreenshotFormat, type PlayerScreenshotFormat } from "../playerScreenshot";
import { formatAppDate } from "../dateTime";
import { mergeRemoteChangelog } from "../changelog";
import DatabaseSettings from "../components/DatabaseSettings";
import { FollowedPlaylistSettingsList } from "../components/settings/FollowedPlaylistSettingsList";
import { scheduleSettingWrite } from "../settingsWriteQueue";
import ProfilesSettings, { ProfilePasswordSettings } from "../components/settings/ProfileSettings";
import { ChannelOwnership, FilterRuleGroups, PlaylistSettingsItem, PluginMultiselect, RuleRow, SidebarNavEditor, TagRow } from "../components/settings/SettingsEditors";
import { ChangelogNote, LogLine, SettingsLoadingState } from "../components/settings/SettingsSupport";
import { SettingsSearch } from "../components/settings/SettingsSearch";

type Tab = "channels" | "tags" | "playlists" | "display" | "plugins" | "advanced" | "profiles" | "auth";

const TIME_ZONES = (() => {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: "timeZone") => string[] };
  const supported = intl.supportedValuesOf?.("timeZone") ?? [
    "Europe/London", "Europe/Warsaw", "America/New_York", "America/Chicago",
    "America/Denver", "America/Los_Angeles", "Asia/Tokyo", "Australia/Sydney",
  ];
  return [...new Set(["UTC", ...supported])];
})();

// Areas unavailable to a profile are omitted entirely, not shown as dead ends.
const SETTINGS_AREAS: { id: Tab; primaryOnly?: boolean }[] = [
  { id: "channels" },
  { id: "tags" },
  { id: "playlists" },
  { id: "display" },
  { id: "plugins" },
  { id: "advanced", primaryOnly: true },
  { id: "profiles" },
  { id: "auth", primaryOnly: true },
];

const DISPLAY_PERMISSION_AREAS: ProfilePermissionArea[] = ["appearance", "feed", "navigation", "playback"];
const DEFAULT_ADMIN_ONLY_AREAS: ProfilePermissionArea[] = ["channels", "followed_playlists", "imports", ...DISPLAY_PERMISSION_AREAS, "plugins", "profiles"];
const GITHUB_RELEASES_URL = "https://github.com/Pelski/ytzero/releases";
const PIN_PROTECTED_PERMISSION_AREAS = new Set<ProfilePermissionArea>(["channels", "followed_playlists", "imports", ...DISPLAY_PERMISSION_AREAS, "plugins", "profiles"]);

const PROFILE_PERMISSION_OPTIONS: { id: ProfilePermissionArea; labelKey: I18nKey; hintKey: I18nKey }[] = [
  { id: "channels", labelKey: "profilePermissionChannels", hintKey: "profilePermissionChannelsHint" },
  { id: "followed_playlists", labelKey: "profilePermissionFollowedPlaylists", hintKey: "profilePermissionFollowedPlaylistsHint" },
  { id: "imports", labelKey: "profilePermissionImports", hintKey: "profilePermissionImportsHint" },
  { id: "tags", labelKey: "profilePermissionTags", hintKey: "profilePermissionTagsHint" },
  { id: "filters", labelKey: "profilePermissionFilters", hintKey: "profilePermissionFiltersHint" },
  { id: "playlists", labelKey: "profilePermissionPlaylists", hintKey: "profilePermissionPlaylistsHint" },
  { id: "appearance", labelKey: "profilePermissionAppearance", hintKey: "profilePermissionAppearanceHint" },
  { id: "feed", labelKey: "profilePermissionFeed", hintKey: "profilePermissionFeedHint" },
  { id: "navigation", labelKey: "profilePermissionNavigation", hintKey: "profilePermissionNavigationHint" },
  { id: "playback", labelKey: "profilePermissionPlayback", hintKey: "profilePermissionPlaybackHint" },
  { id: "plugins", labelKey: "profilePermissionPlugins", hintKey: "profilePermissionPluginsHint" },
  { id: "profiles", labelKey: "profilePermissionProfiles", hintKey: "profilePermissionProfilesHint" },
];

function permissionAreaForTab(tab: Tab): ProfilePermissionArea | null {
  if (tab === "channels" || tab === "tags" || tab === "playlists" || tab === "plugins" || tab === "profiles") return tab;
  if (tab === "advanced") return null;
  return null;
}

// Feed age limit: "off" lives in the unit select so the whole control stays two
// dropdowns (the value select is disabled while the limit is off).
type FeedMaxAgeUnit = "days" | "weeks" | "months" | "years" | "off";
const FEED_MAX_AGE_UNITS: Exclude<FeedMaxAgeUnit, "off">[] = ["days", "weeks", "months", "years"];
const FEED_MAX_AGE_VALUES = Array.from({ length: 30 }, (_, i) => String(i + 1));
const LOG_LINE_LIMIT = 300;
const PLUGIN_SETTING_SAVE_DEBOUNCE_MS = 300;

function isFeedMaxAgeUnit(value: unknown): value is FeedMaxAgeUnit {
  return typeof value === "string" && (FEED_MAX_AGE_UNITS as string[]).includes(value);
}

export default function SettingsPage({ showToast }: { showToast: (m: string) => void }) {
  const [pluginSearchTarget, setPluginSearchTarget] = useState<string | null>(null);
  const controller = useSettingsPageController({ showToast });
  const {
    activeAuthMethod,
    addChannel,
    addFilterRule,
    addPlaylist,
    addRule,
    addTag,
    addingChannel,
    addingTag,
    adminDelegationAvailable,
    advancedSubTab,
    appIconColor,
    appName,
    appNameInput,
    appVersion,
    autoFullscreen,
    canManageAdministrators,
    canManageArea,
    changeChildPin,
    changeChildWatchingMonitor,
    changeDeArrowThumbnails,
    changeDeArrowTitles,
    changeFeedAutoplayBehavior,
    changeFeedAutoplayDirection,
    changeFeedMaxAge,
    changeMembersOnlyVisibility,
    changeWatchedStyle,
    changelog,
    changelogRemoteError,
    channelCustomName,
    channelQuery,
    channelStatusLabel,
    channelStatusOptions,
    channelSubTab,
    channelUrl,
    channels,
    checkForUpdates,
    checkingUpdates,
    childLock,
    childWatchingMonitorEnabled,
    clearExternal,
    clearingExternal,
    createAndAddChannelTag,
    currentSettingsView,
    deArrowThumbnailsEnabled,
    deArrowTitlesEnabled,
    disableChildLock,
    displaySubTab,
    enableChildLock,
    enablePin,
    enablePinConfirm,
    externalVideos,
    feedAutoplayBehavior,
    feedAutoplayDirection,
    feedAutoplayEnabled,
    feedMaxAgeUnit,
    feedMaxAgeValue,
    fileRef,
    filterAction,
    filterChannel,
    filterField,
    filterMatch,
    filterPattern,
    filterRules,
    filteredChannels,
    followExternalChannel,
    followedPlaylists,
    hideLiveFromFeed,
    importFile,
    isChildProfile,
    isCurrentTabLocked,
    isPrimary,
    keyboardSeekSeconds,
    language,
    load,
    loadFollowedPlaylists,
    loadLogs,
    loadSettingsState,
    loading,
    loadingExternal,
    loadingLogs,
    locale,
    lockSettings,
    logs,
    logsAutoScroll,
    logsViewerRef,
    membersOnlyVisibility,
    navConfig,
    navigate,
    newChannelTagColor,
    newChannelTagName,
    newPin,
    newPinConfirm,
    persistNavConfig,
    playerCc,
    playerHl,
    playerQuality,
    playerSpeed,
    playlistIcon,
    playlistName,
    playlistRules,
    playlists,
    pluginSettings,
    pluginSettingsModalId,
    plugins,
    profilePermissions,
    removeExternal,
    removeExternalChannel,
    renameValue,
    renamingChannelId,
    resetNavConfig,
    resetPlugin,
    resettingPluginId,
    ruleField,
    ruleMatch,
    rulePattern,
    ruleTag,
    rules,
    saveAppIconColor,
    saveAppName,
    savePlayer,
    saveRenameChannel,
    saveTimeZone,
    sbCategories,
    sbEnabled,
    screenshotFilename,
    screenshotFormat,
    screenshotQuality,
    section,
    setAppNameInput,
    setAutoFullscreen,
    setChannelCustomName,
    setChannelQuery,
    setChannelUrl,
    setEnablePin,
    setEnablePinConfirm,
    setFilterAction,
    setFilterChannel,
    setFilterField,
    setFilterMatch,
    setFilterPattern,
    setKeyboardSeekSeconds,
    setLanguage,
    setLogsAutoScroll,
    setNewChannelTagColor,
    setNewChannelTagName,
    setNewPin,
    setNewPinConfirm,
    setPlayerCc,
    setPlayerHl,
    setPlayerQuality,
    setPlayerSpeed,
    setPlaylistIcon,
    setPlaylistName,
    setPluginSettingsModalId,
    setRenameValue,
    setRenamingChannelId,
    setRuleField,
    setRuleMatch,
    setRulePattern,
    setRuleTag,
    setScreenshotFilename,
    setScreenshotFormat,
    setScreenshotQuality,
    setSettingsView,
    setSubBg,
    setSubColor,
    setSubSize,
    setTagColor,
    setTagMenuChannelId,
    setTagName,
    setUnlockPin,
    setUpdateCheckInterval,
    settingsLoadError,
    settingsNavGroups,
    settingsReady,
    showShorts,
    showTopChannels,
    startRenameChannel,
    subBg,
    subColor,
    subSize,
    t,
    tab,
    tagColor,
    tagMenuChannelId,
    tagName,
    tagSubTab,
    tags,
    timeZone,
    toggleAdminOnlyArea,
    toggleChannelFollow,
    toggleChannelTag,
    toggleFeedAutoplay,
    toggleLiveFromFeed,
    togglePlugin,
    toggleSb,
    toggleSbCategory,
    toggleShorts,
    toggleTopChannels,
    toggleWatchComments,
    toggleWatchRelated,
    unlockPin,
    unlockSettings,
    updateChannelStatus,
    updateCheck,
    updateCheckError,
    updateCheckInterval,
    updatePluginBlockedTerms,
    updatePluginSetting,
    updatingChannelId,
    updatingChannelStatusId,
    watchShowComments,
    watchShowRelated,
    watchedStyle,
  } = controller;

  if (!settingsReady) return <>
    <PageHeader title={t("settingsTitle")} />
    {settingsLoadError
      ? <SettingsSection><Alert variant="danger" title={t("error")}>{settingsLoadError}</Alert><FormActions><Button onClick={() => void loadSettingsState()}>{t("reload")}</Button></FormActions></SettingsSection>
      : <SettingsLoadingState />}
  </>;

  return (
    <>
      <PageHeader
        title={t("settingsTitle")}
        actions={<><SettingsSearch groups={settingsNavGroups} pluginSettings={pluginSettings} plugins={plugins} t={t} onNavigate={setSettingsView} onOpenPlugin={(pluginId, settingKey) => { setPluginSettingsModalId(pluginId); setPluginSearchTarget(settingKey ?? null); }} />{canManageArea("imports") && <ButtonLink to="/import" leadingIcon={<FolderUp size={16} />}>{t("importDataButton")}</ButtonLink>}</>}
      />

      {childLock.enabled && !childLock.locked && !isPrimary && (
        <button className="settings-unlocked-warning" onClick={lockSettings}>
          <ShieldCheck />
          <span>{t("settingsUnlockedWarning")}</span>
          <strong>{t("lockSettingsNow")}</strong>
        </button>
      )}

      <div className="settings-shell">
        <SettingsNav value={currentSettingsView} groups={settingsNavGroups} onChange={setSettingsView} label={t("settingsTitle")} />
        <div className="settings-shell__content">

      {isCurrentTabLocked && (
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

      {!isCurrentTabLocked && tab === "profiles" && (
        <>
          {activeAuthMethod === "per_profile" && (
            <SettingsSection title={t("authChangeOwnPassword")} description={t("authChangeOwnPasswordHint")}>
              <ProfilePasswordSettings showToast={showToast} />
            </SettingsSection>
          )}

          {canManageArea("profiles") && <ProfilesSettings showToast={showToast} isAdmin={isPrimary} canManageAdministrators={canManageAdministrators} adminDelegationAvailable={adminDelegationAvailable} activeAuthMethod={activeAuthMethod} />}

          {canManageArea("profiles") && !isChildProfile && (
            <SettingsSection title={t("childMonitoringSettingsTitle")}>
              <SettingRow
                label={t("childWatchingMonitorEnabled")}
                description={t("childWatchingMonitorEnabledHint")}
              >
                <Switch
                  checked={childWatchingMonitorEnabled}
                  onCheckedChange={(enabled) => void changeChildWatchingMonitor(enabled)}
                />
              </SettingRow>
            </SettingsSection>
          )}

          {canManageArea("profiles") && <SettingsSection className="child-lock-panel">
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

          </SettingsSection>}

          {isPrimary && canManageArea("profiles") && (
            <SettingsSection
              title={t("profilePermissionsTitle")}
              description={t("profilePermissionsHint")}
            >
              {PROFILE_PERMISSION_OPTIONS.map((option) => (
                <SettingRow
                  key={option.id}
                  label={t(option.labelKey)}
                  description={t(option.hintKey)}
                >
                  <Switch
                    checked={profilePermissions.admin_only_areas.includes(option.id)}
                    ariaLabel={t(option.labelKey)}
                    onCheckedChange={(checked) => void toggleAdminOnlyArea(option.id, checked)}
                  />
                </SettingRow>
              ))}
            </SettingsSection>
          )}

          {isPrimary && canManageArea("profiles") && <ChannelOwnership showToast={showToast} />}
        </>
      )}

      {!isCurrentTabLocked && tab === "auth" && canManageAdministrators && <AuthSettings showToast={showToast} />}

      {!isCurrentTabLocked && tab === "channels" && (
        <SettingsSection>

          {channelSubTab === "list" && canManageArea("channels") && (
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
                {canManageArea("imports") && (
                  <>
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
                  </>
                )}
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
                              {(ch.manual_status ?? "active") !== "active" && <Badge variant="warning" size="sm">{channelStatusLabel(ch.manual_status)}</Badge>}
                              <IconButton variant="ghost" className="channel-rename-btn" label={t("renameChannel")} onClick={() => startRenameChannel(ch)}>
                                <Pencil size={12} />
                              </IconButton>
                            </span>
                            {ch.custom_title && (
                              <div className="channel-original-name">{t("originalChannelName", { name: ch.original_title || ch.channel_id })}</div>
                            )}
                          </>
                        )}
                        {(ch.tags ?? []).length > 0 && (
                          <div className="ch-tags">
                            {(ch.tags ?? []).map((t) => (
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
                        <div className="channel-row-controls">
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
                          <TagPickerMenu tags={tags} selectedTagIds={(ch.tags ?? []).map((tag) => tag.id)} onToggle={(tag) => void toggleChannelTag(ch.channel_id, tag)}>
                            <TagCreateForm title={t("newTag")} name={newChannelTagName} color={newChannelTagColor} placeholder={t("tagNamePlaceholder")} submitLabel={t("addTag")} onNameChange={setNewChannelTagName} onColorChange={setNewChannelTagColor} onSubmit={() => createAndAddChannelTag(ch.channel_id)} />
                          </TagPickerMenu>
                        </Popover>
                        <SelectMenu
                          label={t("channelStatus")}
                          value={ch.manual_status ?? "active"}
                          options={channelStatusOptions}
                          size="sm"
                          floating
                          disabled={updatingChannelStatusId !== null}
                          className="channel-status-select"
                          onChange={(status) => void updateChannelStatus(ch, status)}
                        />
                        </div>
                      </td>
                      <td className="shrink">
                        <Button
                          variant={ch.followed === 0 ? "primary" : "danger"}
                          title={ch.followed === 0 ? t("followAgain") : t("unfollow")}
                          disabled={updatingChannelId !== null}
                          onClick={() => toggleChannelFollow(ch)}
                        >
                          {updatingChannelId === ch.channel_id
                            ? <LoaderCircle size={15} className="spin" />
                            : ch.followed === 0 ? <UserPlus size={15} /> : <UserMinus size={15} />}
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

          {channelSubTab === "playlists" && canManageArea("followed_playlists") && (
            followedPlaylists.length === 0 ? <EmptyState title={t("noFollowedPlaylists")} description={t("noFollowedPlaylistsHint")} /> :
            <FollowedPlaylistSettingsList playlists={followedPlaylists} onChanged={loadFollowedPlaylists} />
          )}

          {channelSubTab === "filters" && canManageArea("filters") && (
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

      {!isCurrentTabLocked && tab === "tags" && (
        <SettingsSection>

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

      {!isCurrentTabLocked && tab === "playlists" && (
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

      <SettingsDisplayView controller={controller} showToast={showToast} />
      {!isCurrentTabLocked && tab === "plugins" && (
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
                    <Button className="plugin-configure-btn" onClick={() => { setPluginSearchTarget(null); setPluginSettingsModalId(plugin.id); }}>
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
                keys: ["total_limit", "per_channel_limit", "random_pick_count", "high_pick_count"],
              },
              {
                id: "personalization",
                title: t("pluginSectionPersonalization"),
                description: t("pluginSectionPersonalizationHint"),
                keys: ["shared_tag_points", "tag_history_points", "tag_history_cap", "watched_channel_points", "watched_channel_cap", "playlist_points", "liked_points", "already_watched_points", "started_points", "recency_points"],
              },
            ];
            const sectionKeys = plugin.id === "discovery" ? discoverySections : null;
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
                      {plugin.icon === "Sparkles" ? <Sparkles /> : plugin.icon === "Download" ? <Download /> : plugin.icon === "UsersRound" ? <UsersRound /> : <Plug />}
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
                    {plugin.id === "social" && <Alert variant="info" title={t("socialSettingsHowTitle")}>{t("socialSettingsHowHint")}</Alert>}
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
                              <div ref={pluginSearchTarget === def.key ? (node) => { if (node) { node.scrollIntoView({ block: "center" }); window.setTimeout(() => setPluginSearchTarget(null), 1400); } } : undefined} key={def.key} className={`plugin-slider-row${def.type === "multiselect" ? " plugin-slider-row--stacked" : ""}${pluginSearchTarget === def.key ? " plugin-slider-row--search-target" : ""}`}>
                                <div className="plugin-slider-copy">
                                  <span className="switch-label">{def.label}</span>
                                  <span className="switch-sub">{def.description}</span>
                                </div>
                                {def.type === "toggle" ? (
                                  <Switch disabled={Boolean(def.adminOnly && !isPrimary)} checked={Number(value) === 1} onCheckedChange={(next) => updatePluginSetting(plugin.id, def.key, next ? 1 : 0)} />
                                ) : def.type === "multiselect" ? (
                                  <PluginMultiselect
                                    value={String(value)}
                                    options={def.options ?? []}
                                    searchPlaceholder={t("searchLanguagePlaceholder")}
                                    disabled={Boolean(def.adminOnly && !isPrimary)}
                                    onChange={(next) => updatePluginSetting(plugin.id, def.key, next)}
                                  />
                                ) : def.type === "text" ? (
                                  <Input
                                    type="text"
                                    className="plugin-text-input"
                                    disabled={Boolean(def.adminOnly && !isPrimary)}
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
                                    disabled={Boolean(def.adminOnly && !isPrimary)}
                                    onChange={(next) => updatePluginSetting(plugin.id, def.key, next)}
                                  />
                                ) : (
                                  <div className="plugin-slider-control">
                                    <Slider disabled={Boolean(def.adminOnly && !isPrimary)} min={def.min ?? 0} max={def.max ?? 100} step={def.step} value={Number(value)} onChange={(next) => updatePluginSetting(plugin.id, def.key, next)} />
                                    <Input disabled={Boolean(def.adminOnly && !isPrimary)} type="number" min={def.min} max={def.max} step={def.step} value={Number(value)} onChange={(e) => updatePluginSetting(plugin.id, def.key, Number(e.target.value))} />
                                  </div>
                                )}
                              </div>
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
                      <span>{t(plugin.id === "social" ? "socialResetHint" : "pluginResetHint")}</span>
                    </div>
                    <Popconfirm message={t(plugin.id === "social" ? "socialResetConfirm" : "pluginResetConfirm")} onConfirm={() => resetPlugin(plugin.id)}>
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

      {!isCurrentTabLocked && tab === "advanced" && (
        <SettingsSection>

          {advancedSubTab === "dangerous" && isPrimary && (
            <>
              <SettingRow label={t("backupRestore")} description={t("backupRestoreHint")}>
                <ButtonLink to="/restore" leadingIcon={<ArchiveRestore size={16} />}>{t("backupRestoreOpen")}</ButtonLink>
              </SettingRow>
              <DatabaseSettings showToast={showToast} />
            </>
          )}

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
                    <RevealList
                      items={ch.videos}
                      previewCount={5}
                      listClassName="external-video-list"
                      showMore={t("showMore")}
                      showLess={t("showLess")}
                      renderRow={(v) => (
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
                      )}
                    />
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
              <Inline justify="between" className="logs-meta">
                <span>{t("logsShowing", { count: logs.lines.length, size: logs.size.toLocaleString(locale) })}</span>
                <Button
                  size="sm"
                  variant="secondary"
                  aria-pressed={logsAutoScroll}
                  onClick={() => setLogsAutoScroll((enabled) => !enabled)}
                >
                  {logsAutoScroll ? t("logsAutoScrollDisable") : t("logsAutoScrollEnable")}
                </Button>
              </Inline>
              <div className="logs-viewer" ref={logsViewerRef}>
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

              {changelogRemoteError && (
                <Alert className="settings-changelog-remote-error" variant="warning" icon={<AlertTriangle />} title={t("changelogRemoteFailed")}>
                  <span>{t("changelogRemoteFailedHint")}</span>
                  <ButtonAnchor size="sm" href={GITHUB_RELEASES_URL} target="_blank" rel="noreferrer" leadingIcon={<ExternalLink size={14} />}>
                    {t("viewReleasesOnGitHub")}
                  </ButtonAnchor>
                </Alert>
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
                <div className="settings-release-groups">
                  {(() => {
                    const highlighted = changelog.releases.filter((release) => release.upcoming || release.available);
                    const history = changelog.releases.filter((release) => !release.upcoming && !release.available);
                    const groups = [
                      highlighted.length > 0 ? {
                        key: "highlighted",
                        title: t(highlighted.some((release) => release.upcoming) ? "changelogUpcomingSection" : "changelogAvailableSection"),
                        releases: highlighted,
                      } : null,
                      history.length > 0 ? { key: "history", title: t("changelogHistory"), releases: history } : null,
                    ].filter((group): group is { key: string; title: string; releases: typeof changelog.releases } => group !== null);
                    return groups.map((group) => <section className="settings-release-group" key={group.key}>
                      <SectionHeader title={group.title} variant="subtle" />
                      <div className="settings-release-list">
                        {group.releases.map((release) => <article className="settings-release" key={release.version}>
                          <header className="settings-release-head">
                            <div>
                              <div className="settings-release-title"><strong>{release.name}</strong></div>
                              {release.publishedAt && <span>{formatAppDate(release.publishedAt, locale, timeZone)}</span>}
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
                        </article>)}
                      </div>
                    </section>);
                  })()}
                </div>
              )}
            </div>
          )}
        </SettingsSection>
      )}
        </div>
      </div>
    </>
  );
}
