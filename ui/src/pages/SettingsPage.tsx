import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import "./SettingsPage.css";
import { createPortal } from "react-dom";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, ArchiveRestore, ArrowRight, Check, CheckCircle2, ChevronDown, ChevronUp, Clock, Download, ExternalLink, Eye, EyeOff, FileText, Filter, FolderUp, GripVertical, Info, ListMinus, LoaderCircle, ListMusic, Pencil, Play, Plug, Plus, RefreshCw, RotateCcw, ShieldCheck, Sparkles, Trash2, Tv, UserMinus, UserPlus, UsersRound, Wrench, X, Zap } from "lucide-react";
import { api, type AppChangelog, type AppLogs, type AppLogStreamEvent, type AppVersion, type AuthMethod, type Channel, type ChannelManualStatus, type ChildLockStatus, type FilterRule, type FollowedPlaylist, type MembersOnlyVisibility, type PluginManifest, type PluginSettingsResponse, type Profile, type ProfilePermissionArea, type ProfilePermissions, type Rule, type Tag, type UpdateCheck, type UserPlaylist, type UserPlaylistRule, type Video, SB_CATEGORIES, PLAYBACK_SPEEDS } from "../api";
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
import { formatAgeUnit, formatVideoCount, LANGUAGES, languageName, useI18n, type I18nKey } from "../i18n";
import { useDocumentTitle } from "../useDocumentTitle";
import { applyWatchedStyle, parseWatchedStyle, WATCHED_STYLES, type WatchedStyle } from "../watchedStyle";
import { VideoThumbnail, watchProgress } from "../components/VideoThumbnail";
import { applyVideoCardSize, parseVideoCardSize, persistVideoCardSize, VIDEO_CARD_SIZE_MAX, VIDEO_CARD_SIZE_MIN } from "../videoCardSize";
import { Alert, Badge, Button, ButtonAnchor, ButtonLink, Chip, ColorPicker, Dialog, Divider, EmptyState, Field, FormActions, IconButton, Inline, Input, InputGroup, PageHeader, Popover, RevealList, SectionHeader, SelectMenu, SettingRow, SettingsNav, SettingsSection, Slider, Switch, Text, type SettingsNavGroup } from "../components/ui";
import { DEFAULT_SCREENSHOT_FILENAME_TEMPLATE, parsePlayerScreenshotFormat, type PlayerScreenshotFormat } from "../playerScreenshot";
import { formatAppDate } from "../dateTime";
import { mergeRemoteChangelog } from "../changelog";
import DatabaseSettings from "../components/DatabaseSettings";
import { scheduleSettingWrite } from "../settingsWriteQueue";
import ProfilesSettings, { ProfilePasswordSettings } from "../components/settings/ProfileSettings";
import { ChannelOwnership, FilterRuleGroups, PlaylistSettingsItem, PluginMultiselect, RuleRow, SidebarNavEditor, TagRow } from "../components/settings/SettingsEditors";
import { ChangelogNote, LogLine, SettingsLoadingState } from "../components/settings/SettingsSupport";

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
  const { t, language, setLanguage, locale, timeZone, setTimeZone } = useI18n();
  useDocumentTitle(t("settingsTitle"));
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const tab: Tab = SETTINGS_AREAS.some((item) => item.id === requestedTab) ? requestedTab as Tab : "channels";
  const section = searchParams.get("section");
  const channelSubTab: "list" | "playlists" | "filters" = section === "filters" || section === "playlists" ? section : "list";
  const tagSubTab: "list" | "rules" = section === "rules" ? "rules" : "list";
  const displaySubTab: "appearance" | "feed" | "navigation" | "playback" | "subtitles" | "screenshots" | "privacy" = section === "feed" || section === "navigation" || section === "playback" || section === "subtitles" || section === "screenshots" || section === "privacy" ? section : section === "sponsorblock" ? "privacy" : "appearance";
  const advancedSubTab: "external" | "logs" | "changelog" | "dangerous" = section === "external" || section === "logs" || section === "dangerous" ? section : "changelog";
  const setSettingsRoute = (nextTab: Tab, nextSection?: string) => {
    const next = new URLSearchParams();
    next.set("tab", nextTab);
    if (nextSection) next.set("section", nextSection);
    setSearchParams(next, { replace: true });
  };
  const setTab = (nextTab: Tab) => setSettingsRoute(nextTab);
  const setChannelSubTab = (nextSection: "list" | "playlists" | "filters") => setSettingsRoute("channels", nextSection === "list" ? undefined : nextSection);
  const setTagSubTab = (nextSection: "list" | "rules") => setSettingsRoute("tags", nextSection === "list" ? undefined : nextSection);
  const setDisplaySubTab = (nextSection: "appearance" | "feed" | "navigation" | "playback" | "subtitles" | "screenshots" | "privacy") => setSettingsRoute("display", nextSection === "appearance" ? undefined : nextSection);
  const setAdvancedSubTab = (nextSection: "external" | "logs" | "changelog" | "dangerous") => setSettingsRoute("advanced", nextSection === "changelog" ? undefined : nextSection);
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
  const pluginSettingSaveQueues = useRef(new Map<string, Promise<void>>());
  const pluginSettingSaveVersions = useRef(new Map<string, number>());
  const pluginSettingSaveTimers = useRef(new Map<string, number>());
  const [loading, setLoading] = useState(true);
  const [settingsReady, setSettingsReady] = useState(false);
  const [settingsLoadError, setSettingsLoadError] = useState("");
  const [addingChannel, setAddingChannel] = useState(false);
  const [updatingChannelId, setUpdatingChannelId] = useState<string | null>(null);
  const [updatingChannelStatusId, setUpdatingChannelStatusId] = useState<string | null>(null);
  const [addingTag, setAddingTag] = useState(false);
  const [externalVideos, setExternalVideos] = useState<Video[]>([]);
  const [loadingExternal, setLoadingExternal] = useState(false);
  const [clearingExternal, setClearingExternal] = useState(false);
  const [logs, setLogs] = useState<AppLogs | null>(null);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [logsAutoScroll, setLogsAutoScroll] = useState(true);
  const logsViewerRef = useRef<HTMLDivElement>(null);
  const [appVersion, setAppVersion] = useState<AppVersion | null>(null);
  const [changelog, setChangelog] = useState<AppChangelog | null>(null);
  const [updateCheck, setUpdateCheck] = useState<UpdateCheck | null>(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updateCheckError, setUpdateCheckError] = useState(false);
  const [changelogRemoteError, setChangelogRemoteError] = useState(false);
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
  // App-wide settings (app name, icon color, timezone, child lock) are owned by the
  // primary profile; other profiles see them read-only.
  const [isPrimary, setIsPrimary] = useState(false);
  const [canManageAdministrators, setCanManageAdministrators] = useState(false);
  const [adminDelegationAvailable, setAdminDelegationAvailable] = useState(false);
  const [activeAuthMethod, setActiveAuthMethod] = useState<AuthMethod>("none");
  const [isChildProfile, setIsChildProfile] = useState<boolean | null>(null);
  const [showShorts, setShowShorts] = useState(false);
  const [showTopChannels, setShowTopChannels] = useState(true);
  const [hideLiveFromFeed, setHideLiveFromFeed] = useState(false);
  const [watchShowRelated, setWatchShowRelated] = useState(true);
  const [watchShowComments, setWatchShowComments] = useState(false);
  const [feedMaxAgeValue, setFeedMaxAgeValue] = useState("6");
  const [feedMaxAgeUnit, setFeedMaxAgeUnit] = useState<FeedMaxAgeUnit>("months");
  const [feedAutoplayEnabled, setFeedAutoplayEnabled] = useState(false);
  const [feedAutoplayBehavior, setFeedAutoplayBehavior] = useState<"autoplay" | "prompt">("autoplay");
  const [feedAutoplayDirection, setFeedAutoplayDirection] = useState<"oldest" | "newest">("newest");
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
  const [screenshotFormat, setScreenshotFormat] = useState<PlayerScreenshotFormat>("jpeg");
  const [screenshotQuality, setScreenshotQuality] = useState("0.92");
  const [screenshotFilename, setScreenshotFilename] = useState(DEFAULT_SCREENSHOT_FILENAME_TEMPLATE);
  const [autoFullscreen, setAutoFullscreen] = useState(false);
  const [sbEnabled, setSbEnabled] = useState(false);
  const [sbCategories, setSbCategories] = useState<string[]>(["sponsor"]);
  const [deArrowTitlesEnabled, setDeArrowTitlesEnabled] = useState(false);
  const [deArrowThumbnailsEnabled, setDeArrowThumbnailsEnabled] = useState(false);
  const [childWatchingMonitorEnabled, setChildWatchingMonitorEnabled] = useState(true);
  const [childLock, setChildLock] = useState<ChildLockStatus>({ enabled: false, locked: false });
  const [profilePermissions, setProfilePermissions] = useState<ProfilePermissions>({ admin_only_areas: DEFAULT_ADMIN_ONLY_AREAS });
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
      const [ch, unfollowed, tg, rl, fr, pl] = await Promise.all([api.channels(), api.unfollowedChannels(), api.tags(), api.rules(), api.filterRules(), api.userPlaylists()]);
      setChannels([...ch.channels, ...unfollowed.channels]
        .map((channel) => ({ ...channel, tags: channel.tags ?? [] }))
        .sort((a, b) => a.title.localeCompare(b.title, locale)));
      setTags(tg.tags);
      setRules(rl.rules);
      setFilterRules(fr.rules);
      setPlaylists(pl.playlists);
      const rulePairs = await Promise.all(pl.playlists.map(async (p) => [p.id, (await api.userPlaylistRules(p.id)).rules] as const));
      setPlaylistRules(Object.fromEntries(rulePairs));
    } finally {
      setLoading(false);
    }
  }, [locale]);

  const toggleChannelFollow = async (channel: Channel) => {
    if (updatingChannelId) return;
    const followed = channel.followed === 0;
    setUpdatingChannelId(channel.channel_id);
    try {
      await api.followChannel(channel.channel_id, followed);
      emit("channels-changed");
      await load();
    } catch (error) {
      showToast(`${t("error")}: ${error instanceof Error ? error.message : error}`);
    } finally {
      setUpdatingChannelId(null);
    }
  };

  const updateChannelStatus = async (channel: Channel, status: ChannelManualStatus) => {
    if (updatingChannelStatusId) return;
    const previous = channel.manual_status ?? "active";
    setUpdatingChannelStatusId(channel.channel_id);
    setChannels((current) => current.map((item) => item.channel_id === channel.channel_id ? { ...item, manual_status: status } : item));
    try {
      await api.setChannelStatus(channel.channel_id, status);
      showToast(status === "active" ? t("channelStatusRestored") : t("channelStatusUpdated"));
    } catch (error) {
      setChannels((current) => current.map((item) => item.channel_id === channel.channel_id ? { ...item, manual_status: previous } : item));
      showToast(error instanceof Error ? error.message : String(error));
    } finally {
      setUpdatingChannelStatusId(null);
    }
  };

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

  const loadChangelog = useCallback(async () => {
    setChangelogRemoteError(false);
    try {
      const [version, bundledChangelog] = await Promise.all([api.version(), api.changelog()]);
      setAppVersion(version);
      setChangelog(bundledChangelog);
      try {
        const remote = await api.checkUpdates();
        setUpdateCheck(remote);
        setChangelog(mergeRemoteChangelog(bundledChangelog, remote));
      } catch {
        setChangelogRemoteError(true);
      }
    } catch (error) {
      console.error(error);
    }
  }, []);

  const checkForUpdates = async () => {
    setCheckingUpdates(true);
    setUpdateCheckError(false);
    try {
      const remote = await api.checkUpdates();
      setUpdateCheck(remote);
      setChangelog((current) => current ? mergeRemoteChangelog(current, remote) : current);
      setChangelogRemoteError(false);
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
    if (!isPrimary || tab !== "advanced") return;
    if (advancedSubTab === "external") loadExternal();
    if (advancedSubTab === "changelog") loadChangelog();
  }, [isPrimary, tab, advancedSubTab, loadExternal, loadLogs, loadChangelog]);

  useEffect(() => {
    if (!isPrimary || tab !== "advanced" || advancedSubTab !== "logs") return;
    setLoadingLogs(true);
    const source = api.logsStream(LOG_LINE_LIMIT);
    let receivedSnapshot = false;

    const handleSnapshot = (event: MessageEvent<string>) => {
      try {
        setLogs(JSON.parse(event.data) as AppLogs);
        receivedSnapshot = true;
        setLoadingLogs(false);
      } catch (error) {
        console.error(error);
      }
    };
    const handleLine = (event: MessageEvent<string>) => {
      try {
        const entry = JSON.parse(event.data) as AppLogStreamEvent;
        setLogs((current) => current ? {
          ...current,
          size: entry.size,
          lines: [...current.lines, entry.line].slice(-LOG_LINE_LIMIT),
        } : current);
      } catch (error) {
        console.error(error);
      }
    };

    source.addEventListener("snapshot", handleSnapshot);
    source.addEventListener("log", handleLine);
    source.onerror = () => {
      if (!receivedSnapshot) loadLogs();
    };

    return () => {
      source.removeEventListener("snapshot", handleSnapshot);
      source.removeEventListener("log", handleLine);
      source.close();
    };
  }, [isPrimary, tab, advancedSubTab, loadLogs]);

  useLayoutEffect(() => {
    if (advancedSubTab !== "logs" || !logsAutoScroll || !logs?.lines.length) return;
    const viewer = logsViewerRef.current;
    if (viewer) viewer.scrollTop = viewer.scrollHeight;
  }, [advancedSubTab, logs, logsAutoScroll]);

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

  const loadSettingsState = useCallback(async () => {
    setSettingsReady(false);
    setSettingsLoadError("");
    try {
      const [auth, child, r, cl, permissions] = await Promise.all([
        api.authStatus(),
        api.childStatus(),
        api.settings(),
        api.childLock(),
        api.profilePermissions(),
      ]);
      // "Admin" = primary profile OR an OIDC session in the configured admin group.
      // is_admin drives the admin-only tabs/sections (kept in the isPrimary var).
      setIsPrimary(!!auth.is_admin);
      setCanManageAdministrators(auth.can_manage_administrators);
      setAdminDelegationAvailable(auth.admin_delegation_available);
      setActiveAuthMethod(auth.method);
      setIsChildProfile(child.is_child);
      const name = r.settings.app_name || "YT Zero";
      setAppName(name);
      setAppNameInput(name);
      setAppIconColor(r.settings.app_icon_color || "#0a5fff");
      setUpdateCheckInterval(r.settings.update_check_interval || "off");
      setShowShorts(r.settings.show_shorts === "1");
      setShowTopChannels(r.settings.show_top_channels !== "0");
      setHideLiveFromFeed(r.settings.hide_live_from_feed === "1");
      setWatchShowRelated(r.settings.watch_show_related !== "0");
      setWatchShowComments(r.settings.watch_show_comments === "1");
      setFeedMaxAgeValue(r.settings.feed_max_age_value || "6");
      setFeedMaxAgeUnit(isFeedMaxAgeUnit(r.settings.feed_max_age_unit) ? r.settings.feed_max_age_unit : "off");
      setFeedAutoplayEnabled(r.settings.feed_autoplay_enabled === "1");
      setFeedAutoplayBehavior(r.settings.feed_autoplay_behavior === "prompt" ? "prompt" : "autoplay");
      setFeedAutoplayDirection(r.settings.feed_autoplay_direction === "newest" ? "newest" : "oldest");
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
      setScreenshotFormat(parsePlayerScreenshotFormat(r.settings.player_screenshot_format));
      setScreenshotQuality(r.settings.player_screenshot_quality ?? "0.92");
      setScreenshotFilename(r.settings.player_screenshot_filename || DEFAULT_SCREENSHOT_FILENAME_TEMPLATE);
      setAutoFullscreen(r.settings.auto_fullscreen_landscape === "1");
      setSbEnabled(r.settings.sponsorblock_enabled === "1");
      setDeArrowTitlesEnabled(r.settings.dearrow_titles_enabled === "1");
      setDeArrowThumbnailsEnabled(r.settings.dearrow_thumbnails_enabled === "1");
      setChildWatchingMonitorEnabled(r.settings.child_watching_monitor_enabled !== "0");
      try { setSbCategories(JSON.parse(r.settings.sponsorblock_categories || '["sponsor"]')); } catch {}
      setChildLock(cl.child_lock);
      setProfilePermissions(permissions.permissions);
      setSettingsReady(true);
    } catch (error) {
      console.error(error);
      setSettingsLoadError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    void loadSettingsState();
    load().catch(console.error);
    loadPlugins();
  }, [load, loadPlugins, loadSettingsState]);

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

  const updatePluginSetting = (pluginId: string, key: string, value: number | string) => {
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
    const saveKey = `${pluginId}:${key}`;
    const version = (pluginSettingSaveVersions.current.get(saveKey) ?? 0) + 1;
    pluginSettingSaveVersions.current.set(saveKey, version);
    const pendingTimer = pluginSettingSaveTimers.current.get(saveKey);
    if (pendingTimer != null) window.clearTimeout(pendingTimer);
    const timer = window.setTimeout(() => {
      pluginSettingSaveTimers.current.delete(saveKey);
      const previous = pluginSettingSaveQueues.current.get(saveKey) ?? Promise.resolve();
      const save = previous.catch(() => {}).then(async () => {
        try {
          const next = await api.updatePluginSettings(pluginId, { [key]: value });
          if (pluginSettingSaveVersions.current.get(saveKey) !== version) return;
          setPluginSettings((current) => {
            const currentPlugin = current[pluginId];
            if (!currentPlugin) return current;
            return {
              ...current,
              [pluginId]: {
                ...next,
                settings: { ...next.settings, ...currentPlugin.settings, [key]: next.settings[key] },
                terms: currentPlugin.terms ?? next.terms,
              },
            };
          });
          emit("plugins-changed");
        } catch (e) {
          if (pluginSettingSaveVersions.current.get(saveKey) !== version) return;
          try {
            const latest = await api.pluginSettings(pluginId);
            setPluginSettings((current) => ({ ...current, [pluginId]: latest }));
          } catch {
            // Preserve the optimistic value if even the recovery read failed.
          }
          showToast(e instanceof Error ? e.message : String(e));
        }
      });
      pluginSettingSaveQueues.current.set(saveKey, save);
      void save.finally(() => {
        if (pluginSettingSaveQueues.current.get(saveKey) === save) pluginSettingSaveQueues.current.delete(saveKey);
      });
    }, PLUGIN_SETTING_SAVE_DEBOUNCE_MS);
    pluginSettingSaveTimers.current.set(saveKey, timer);
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
    const saveKey = `${pluginId}:blockedTerms`;
    const version = (pluginSettingSaveVersions.current.get(saveKey) ?? 0) + 1;
    pluginSettingSaveVersions.current.set(saveKey, version);
    const previous = pluginSettingSaveQueues.current.get(saveKey) ?? Promise.resolve();
    const save = previous.catch(() => {}).then(async () => {
      try {
        const next = await api.updatePluginSettings(pluginId, { blockedTerms });
        if (pluginSettingSaveVersions.current.get(saveKey) !== version) return;
        setPluginSettings((current) => ({ ...current, [pluginId]: next }));
      } catch (e) {
        if (pluginSettingSaveVersions.current.get(saveKey) !== version) return;
        try {
          const latest = await api.pluginSettings(pluginId);
          setPluginSettings((current) => ({ ...current, [pluginId]: latest }));
        } catch {
          // Preserve the optimistic value if even the recovery read failed.
        }
        showToast(e instanceof Error ? e.message : String(e));
      }
    });
    pluginSettingSaveQueues.current.set(saveKey, save);
    await save;
    if (pluginSettingSaveQueues.current.get(saveKey) === save) pluginSettingSaveQueues.current.delete(saveKey);
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

  const toggleWatchRelated = async () => {
    const next = !watchShowRelated;
    setWatchShowRelated(next);
    await api.updateSettings({ watch_show_related: next ? "1" : "0" });
    showToast(t("displaySettingsSaved"));
  };

  const toggleWatchComments = async () => {
    const next = !watchShowComments;
    setWatchShowComments(next);
    await api.updateSettings({ watch_show_comments: next ? "1" : "0" });
    showToast(t("displaySettingsSaved"));
  };

  const changeFeedMaxAge = async (value: string, unit: FeedMaxAgeUnit) => {
    setFeedMaxAgeValue(value);
    setFeedMaxAgeUnit(unit);
    await api.updateSettings({ feed_max_age_value: value, feed_max_age_unit: unit });
    showToast(t("displaySettingsSaved"));
  };

  const toggleFeedAutoplay = async () => {
    const next = !feedAutoplayEnabled;
    setFeedAutoplayEnabled(next);
    await api.updateSettings({ feed_autoplay_enabled: next ? "1" : "0" });
    showToast(t("displaySettingsSaved"));
  };

  const changeFeedAutoplayDirection = async (next: "oldest" | "newest") => {
    setFeedAutoplayDirection(next);
    await api.updateSettings({ feed_autoplay_direction: next });
    showToast(t("displaySettingsSaved"));
  };

  const changeFeedAutoplayBehavior = async (next: "autoplay" | "prompt") => {
    setFeedAutoplayBehavior(next);
    await api.updateSettings({ feed_autoplay_behavior: next });
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

  const saveAppIconColor = (color: string) => {
    setAppIconColor(color);
    scheduleSettingWrite("app_icon_color", { app_icon_color: color }, {
      onSaved: () => { emit("app-name-changed"); showToast(t("appIconColorSaved")); },
      onError: (error) => { load(); showToast(error instanceof Error ? error.message : String(error)); },
    });
  };

  const saveTimeZone = async (next: string) => {
    await setTimeZone(next);
    showToast(t("timeZoneSaved"));
  };

  const savePlayer = async (patch: Record<string, string>) => {
    await api.updateSettings(patch);
    emit("player-settings-changed");
    showToast(t("playerSettingsSaved"));
  };

  const toggleSb = async () => {
    const next = !sbEnabled;
    setSbEnabled(next);
    await api.updateSettings({ sponsorblock_enabled: next ? "1" : "0" });
    emit("player-settings-changed");
    showToast(t("sponsorblockSaved"));
  };

  const toggleSbCategory = async (id: string) => {
    const next = sbCategories.includes(id)
      ? sbCategories.filter((c) => c !== id)
      : [...sbCategories, id];
    setSbCategories(next);
    await api.updateSettings({ sponsorblock_categories: JSON.stringify(next) });
    emit("player-settings-changed");
    showToast(t("sponsorblockSaved"));
  };

  const changeDeArrowTitles = async (enabled: boolean) => {
    const previous = deArrowTitlesEnabled;
    setDeArrowTitlesEnabled(enabled);
    try {
      await api.updateSettings({ dearrow_titles_enabled: enabled ? "1" : "0" });
      emit("player-settings-changed");
      showToast(t("dearrowSaved"));
    } catch (error) {
      setDeArrowTitlesEnabled(previous);
      showToast(error instanceof Error ? error.message : t("error"));
    }
  };

  const changeDeArrowThumbnails = async (enabled: boolean) => {
    const previous = deArrowThumbnailsEnabled;
    setDeArrowThumbnailsEnabled(enabled);
    try {
      await api.updateSettings({ dearrow_thumbnails_enabled: enabled ? "1" : "0" });
      emit("player-settings-changed");
      showToast(t("dearrowSaved"));
    } catch (error) {
      setDeArrowThumbnailsEnabled(previous);
      showToast(error instanceof Error ? error.message : t("error"));
    }
  };

  const showPinError = () => showToast(t("pinMustBeSixDigits"));
  const isValidPin = (pin: string) => /^\d{6}$/.test(pin);

  const changeChildWatchingMonitor = async (enabled: boolean) => {
    const previous = childWatchingMonitorEnabled;
    setChildWatchingMonitorEnabled(enabled);
    try {
      await api.updateSettings({ child_watching_monitor_enabled: enabled ? "1" : "0" });
      emit("child-watching-settings-changed");
      showToast(t("childWatchingMonitorSaved"));
    } catch (error) {
      setChildWatchingMonitorEnabled(previous);
      showToast(error instanceof Error ? error.message : t("error"));
    }
  };

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

  const toggleAdminOnlyArea = async (area: ProfilePermissionArea, adminOnly: boolean) => {
    const previous = profilePermissions;
    const adminOnlyAreas = adminOnly
      ? [...new Set([...profilePermissions.admin_only_areas, area])]
      : profilePermissions.admin_only_areas.filter((item) => item !== area);
    setProfilePermissions({ admin_only_areas: adminOnlyAreas });
    try {
      const result = await api.updateProfilePermissions(adminOnlyAreas);
      setProfilePermissions(result.permissions);
    } catch (error) {
      setProfilePermissions(previous);
      showToast(`${t("error")}: ${error instanceof Error ? error.message : error}`);
    }
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
  const channelStatusOptions: { value: ChannelManualStatus; label: string }[] = [
    { value: "active", label: t("channelStatusActive") },
    { value: "paused", label: t("channelStatusPaused") },
    { value: "broken", label: t("channelStatusBroken") },
    { value: "banned", label: t("channelStatusBanned") },
    { value: "deleted", label: t("channelStatusDeleted") },
  ];
  const channelStatusLabel = (status: ChannelManualStatus | undefined) => channelStatusOptions.find((option) => option.value === (status ?? "active"))?.label ?? t("channelStatusActive");
  const filteredChannels = normalizedChannelQuery
    ? channels.filter((ch) => {
        const title = (ch.title || "").toLowerCase();
        const channelId = ch.channel_id.toLowerCase();
        return title.includes(normalizedChannelQuery) || channelId.includes(normalizedChannelQuery);
      })
    : channels;
  const canManageArea = (area: ProfilePermissionArea) => isPrimary || !profilePermissions.admin_only_areas.includes(area);
  const channelSubTabOptions: { value: "list" | "playlists" | "filters"; label: string; count: number }[] = [
    ...(canManageArea("channels") ? [{ value: "list" as const, label: t("channels"), count: channels.length }] : []),
    ...(canManageArea("followed_playlists") ? [{ value: "playlists" as const, label: t("followedPlaylists"), count: followedPlaylists.length }] : []),
    ...(canManageArea("filters") ? [{ value: "filters" as const, label: t("filters"), count: filterRules.length }] : []),
  ];
  const displaySubTabOptions: { value: "appearance" | "feed" | "navigation" | "playback" | "subtitles" | "screenshots" | "privacy"; label: string }[] = [
    ...(canManageArea("appearance") ? [{ value: "appearance" as const, label: t("displayAppearance") }] : []),
    ...(canManageArea("feed") ? [{ value: "feed" as const, label: t("displayFeed") }] : []),
    ...(canManageArea("navigation") ? [{ value: "navigation" as const, label: t("displayNavigation") }] : []),
    ...(canManageArea("playback") ? [
      { value: "playback" as const, label: t("displayPlayback") },
      { value: "subtitles" as const, label: t("subtitles") },
      { value: "screenshots" as const, label: t("playerScreenshots") },
      { value: "privacy" as const, label: t("displayPrivacy") },
    ] : []),
  ];
  const currentPermissionArea = tab === "channels"
    ? channelSubTab === "playlists" ? "followed_playlists" : channelSubTab === "filters" ? "filters" : "channels"
    : tab === "display"
      ? displaySubTab === "appearance" || displaySubTab === "feed" || displaySubTab === "navigation" ? displaySubTab : "playback"
    : tab === "profiles" && activeAuthMethod === "per_profile" && !canManageArea("profiles") ? null
    : permissionAreaForTab(tab);
  const isCurrentTabLocked = childLock.enabled
    && childLock.locked
    && currentPermissionArea != null
    && PIN_PROTECTED_PERMISSION_AREAS.has(currentPermissionArea);
  const visibleAreas = SETTINGS_AREAS.filter((tabItem) => {
    const permissionArea = permissionAreaForTab(tabItem.id);
    const hasVisibleChannelSection = tabItem.id !== "channels" || channelSubTabOptions.length > 0;
    const hasVisibleDisplaySection = tabItem.id !== "display" || DISPLAY_PERMISSION_AREAS.some(canManageArea);
    return (!tabItem.primaryOnly || isPrimary)
      && (tabItem.id !== "auth" || canManageAdministrators)
      && hasVisibleChannelSection
      && hasVisibleDisplaySection
      && (tabItem.id === "channels" || isPrimary || permissionArea == null || !profilePermissions.admin_only_areas.includes(permissionArea) || (tabItem.id === "profiles" && activeAuthMethod === "per_profile"));
  });
  const tabIsVisible = (candidate: Tab) => visibleAreas.some((tabItem) => tabItem.id === candidate);
  const currentSettingsView = tab === "channels"
    ? channelSubTab === "list" ? "channels" : `channels:${channelSubTab}`
    : tab === "tags"
      ? tagSubTab === "list" ? "tags" : "tags:rules"
      : tab === "display"
        ? displaySubTab === "appearance" ? "display" : `display:${displaySubTab}`
        : tab === "advanced"
          ? advancedSubTab === "changelog" ? "advanced" : `advanced:${advancedSubTab}`
          : tab;
  const settingsNavGroups: SettingsNavGroup<string>[] = [
    {
      label: t("settingsGroupLibrary"),
      items: [
        ...(channelSubTabOptions.some((option) => option.value === "list") ? [{ value: "channels", label: t("channels"), count: channels.length }] : []),
        ...(channelSubTabOptions.some((option) => option.value === "playlists") ? [{ value: "channels:playlists", label: t("followedPlaylists"), count: followedPlaylists.length }] : []),
        ...(channelSubTabOptions.some((option) => option.value === "filters") ? [{ value: "channels:filters", label: t("filters"), count: filterRules.length }] : []),
        ...(tabIsVisible("tags") ? [{ value: "tags", label: t("tags"), count: tags.length }, { value: "tags:rules", label: t("rules"), count: rules.length }] : []),
        ...(tabIsVisible("playlists") ? [{ value: "playlists", label: t("playlists"), count: playlists.length }] : []),
      ],
    },
    {
      label: t("settingsGroupExperience"),
      items: tabIsVisible("display") ? displaySubTabOptions.map((option) => ({
        value: option.value === "appearance" ? "display" : `display:${option.value}`,
        label: option.label,
      })) : [],
    },
    {
      label: t("settingsGroupAdministration"),
      items: [
        ...(tabIsVisible("plugins") ? [{ value: "plugins", label: t("pluginsTab") }] : []),
        ...(tabIsVisible("profiles") ? [{ value: "profiles", label: t("profiles") }] : []),
        ...(tabIsVisible("auth") ? [{ value: "auth", label: t("authTab") }] : []),
      ],
    },
    {
      label: t("settingsGroupSystem"),
      items: tabIsVisible("advanced") ? [
        { value: "advanced", label: t("changelog") },
        { value: "advanced:logs", label: t("logs") },
        { value: "advanced:external", label: t("navExternal"), count: externalVideos.length },
        { value: "advanced:dangerous", label: t("dangerous") },
      ] : [],
    },
  ].filter((group) => group.items.length > 0);
  const setSettingsView = (next: string) => {
    const [nextTab, nextSection] = next.split(":") as [Tab, string | undefined];
    setSettingsRoute(nextTab, nextSection);
  };

  useEffect(() => {
    if (!settingsReady || isChildProfile == null) return;
    if (!visibleAreas.some((tabItem) => tabItem.id === tab)) {
      setTab(visibleAreas[0]?.id ?? "tags");
    }
  }, [settingsReady, isChildProfile, isPrimary, canManageAdministrators, profilePermissions.admin_only_areas, tab]);

  useEffect(() => {
    if (!settingsReady || tab !== "channels" || channelSubTabOptions.some((option) => option.value === channelSubTab)) return;
    const next = channelSubTabOptions[0]?.value;
    if (next) setChannelSubTab(next);
  }, [settingsReady, tab, channelSubTab, channelSubTabOptions.map((option) => option.value).join(",")]);

  useEffect(() => {
    if (!settingsReady || tab !== "display" || displaySubTabOptions.some((option) => option.value === displaySubTab)) return;
    const next = displaySubTabOptions[0]?.value;
    if (next) setDisplaySubTab(next);
  }, [settingsReady, tab, displaySubTab, displaySubTabOptions.map((option) => option.value).join(",")]);

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
        actions={canManageArea("imports") ? <>
          <ButtonLink to="/import" leadingIcon={<FolderUp size={16} />}>{t("importDataButton")}</ButtonLink>
        </> : undefined}
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

      {!isCurrentTabLocked && tab === "display" && (
        <>
          <div className="settings-display-groups">

          {displaySubTab === "appearance" && canManageArea("appearance") && <SettingsSection title={t("displayAppearance")} className="settings-display-group">
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

              <SettingRow label={t("timeZoneLabel")} description={t("timeZoneHint")}>
                <SelectMenu
                  searchable
                  label={t("timeZoneLabel")}
                  value={timeZone}
                  options={[...new Set([timeZone, ...TIME_ZONES])].map((zone) => ({ value: zone, label: zone }))}
                  onChange={saveTimeZone}
                />
              </SettingRow>
            </>
          ) : (
            <Text tone="secondary">{t("primaryOnlyHint")}</Text>
          )}

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
          </SettingsSection>

          }

          {displaySubTab === "feed" && canManageArea("feed") && <SettingsSection title={t("displayFeed")} className="settings-display-group">

          <SettingRow label={t("hideLiveFromFeed")} description={t("hideLiveFromFeedHint")}>
            <Switch checked={hideLiveFromFeed} onCheckedChange={() => toggleLiveFromFeed()} />
          </SettingRow>

          <SettingRow label={t("feedMaxAge")} description={t("feedMaxAgeHint")}>
            <Inline gap={2} className="feed-max-age-control">
              <SelectMenu
                label={t("feedMaxAge")}
                value={feedMaxAgeValue}
                disabled={feedMaxAgeUnit === "off"}
                onChange={(next: string) => changeFeedMaxAge(next, feedMaxAgeUnit)}
                options={FEED_MAX_AGE_VALUES.map((value) => ({ value, label: value }))}
              />
              <SelectMenu
                label={t("feedMaxAge")}
                value={feedMaxAgeUnit}
                onChange={(next: FeedMaxAgeUnit) => changeFeedMaxAge(feedMaxAgeValue, next)}
                options={[
                  ...FEED_MAX_AGE_UNITS.map((unit) => ({
                    value: unit as FeedMaxAgeUnit,
                    label: formatAgeUnit(Number(feedMaxAgeValue) || 1, unit, language),
                  })),
                  { value: "off" as FeedMaxAgeUnit, label: t("feedMaxAgeOff") },
                ]}
              />
            </Inline>
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

          </SettingsSection>
          }

          {displaySubTab === "playback" && canManageArea("playback") && <SettingsSection title={t("displayPlayback")} className="settings-display-group">
          <SettingRow label={t("watchShowRelated")} description={t("watchShowRelatedHint")}>
            <Switch checked={watchShowRelated} onCheckedChange={() => toggleWatchRelated()} />
          </SettingRow>

          <SettingRow label={t("watchShowComments")} description={t("watchShowCommentsHint")}>
            <Switch checked={watchShowComments} onCheckedChange={() => toggleWatchComments()} />
          </SettingRow>

          <SettingRow label={t("feedAutoplay")} description={t("feedAutoplayHint")}>
            <Switch checked={feedAutoplayEnabled} onCheckedChange={() => toggleFeedAutoplay()} />
          </SettingRow>

          {feedAutoplayEnabled && (
            <>
              <SettingRow label={t("feedAutoplayBehavior")} description={t("feedAutoplayBehaviorHint")}>
                <SelectMenu
                  label={t("feedAutoplayBehavior")}
                  value={feedAutoplayBehavior}
                  onChange={changeFeedAutoplayBehavior}
                  options={[
                    { value: "autoplay", label: t("feedAutoplayBehaviorPlay") },
                    { value: "prompt", label: t("feedAutoplayBehaviorPrompt") },
                  ]}
                />
              </SettingRow>
              <SettingRow label={t("feedAutoplayDirection")} description={t("feedAutoplayDirectionHint")}>
                <SelectMenu
                  label={t("feedAutoplayDirection")}
                  value={feedAutoplayDirection}
                  onChange={changeFeedAutoplayDirection}
                  options={[
                    { value: "newest", label: t("feedAutoplayNewestFirst") },
                    { value: "oldest", label: t("feedAutoplayOldestFirst") },
                  ]}
                />
              </SettingRow>
            </>
          )}
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
          }

          {displaySubTab === "subtitles" && canManageArea("playback") && <SettingsSection title={t("subtitles")} className="settings-display-group">
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
              <div className="ui-control-description">{t("subtitleStyleHint")}</div>
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
                  onChange={(next) => {
                    setSubColor(next);
                    scheduleSettingWrite("player_sub_color", { player_sub_color: next }, {
                      onSaved: () => { emit("player-settings-changed"); showToast(t("playerSettingsSaved")); },
                      onError: (error) => { load(); showToast(error instanceof Error ? error.message : String(error)); },
                    });
                  }}
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
          </SettingsSection>
          }

          {displaySubTab === "screenshots" && canManageArea("playback") && <SettingsSection title={t("playerScreenshots")} className="settings-display-group">
          <SettingRow label={t("playerScreenshotFormat")} description={t("playerScreenshotFormatHint")}>
            <SelectMenu
              label={t("playerScreenshotFormat")}
              value={screenshotFormat}
              options={([
                { value: "jpeg", label: "JPG" },
                { value: "png", label: "PNG" },
                { value: "webp", label: "WebP" },
              ] as const)}
              onChange={(next) => {
                setScreenshotFormat(next);
                savePlayer({ player_screenshot_format: next });
              }}
            />
          </SettingRow>

          <SettingRow label={t("playerScreenshotQuality")}>
            <Input
              aria-label={t("playerScreenshotQuality")}
              type="number"
              min={0.1}
              max={1}
              step={0.01}
              value={screenshotQuality}
              disabled={screenshotFormat === "png"}
              onChange={(event) => setScreenshotQuality(event.target.value)}
              onBlur={() => {
                const next = String(Math.min(1, Math.max(0.1, Number(screenshotQuality) || 0.92)));
                setScreenshotQuality(next);
                savePlayer({ player_screenshot_quality: next });
              }}
            />
          </SettingRow>

          <SettingRow label={t("playerScreenshotFilename")} description={t("playerScreenshotFilenameHint")}>
            <Input
              aria-label={t("playerScreenshotFilename")}
              value={screenshotFilename}
              placeholder={DEFAULT_SCREENSHOT_FILENAME_TEMPLATE}
              onChange={(event) => setScreenshotFilename(event.target.value)}
              onBlur={() => {
                const next = screenshotFilename.trim() || DEFAULT_SCREENSHOT_FILENAME_TEMPLATE;
                setScreenshotFilename(next);
                savePlayer({ player_screenshot_filename: next });
              }}
            />
          </SettingRow>

          </SettingsSection>
          }

          {displaySubTab === "privacy" && canManageArea("playback") && <>
          <SettingsSection title="DeArrow" className="settings-display-group">
          <SettingRow
            label={t("dearrowTitlesEnabled")}
            description={t("dearrowTitlesHint")}
          >
            <Switch checked={deArrowTitlesEnabled} onCheckedChange={(enabled) => void changeDeArrowTitles(enabled)} />
          </SettingRow>
          <SettingRow
            label={t("dearrowThumbnailsEnabled")}
            description={<>{t("dearrowThumbnailsHint")} <a href="https://sponsor.ajay.app/" target="_blank" rel="noreferrer">{t("dearrowAttribution")}</a></>}
          >
            <Switch checked={deArrowThumbnailsEnabled} onCheckedChange={(enabled) => void changeDeArrowThumbnails(enabled)} />
          </SettingRow>
          </SettingsSection>

          <SettingsSection title="SponsorBlock" className="settings-display-group">
          <SettingRow label={t("sponsorblockEnabled")} description={t("sponsorblockHint")}>
            <Switch checked={sbEnabled} onCheckedChange={() => toggleSb()} />
          </SettingRow>

          {sbEnabled && (
            <div className="sb-category-grid">
              <div className="ui-control-description" style={{ gridColumn: "1 / -1", marginBottom: 2 }}>{t("sponsorblockCategories")}</div>
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
          </>
          }

          {displaySubTab === "navigation" && canManageArea("navigation") && <SettingsSection title={t("displayNavigation")} className="settings-display-group">
          <SettingRow label={t("showShorts")} description={t("showShortsHint")}>
            <Switch checked={showShorts} onCheckedChange={() => toggleShorts()} />
          </SettingRow>

          <SettingRow label={t("showTopChannels")} description={t("showTopChannelsHint")}>
            <Switch checked={showTopChannels} onCheckedChange={() => toggleTopChannels()} />
          </SettingRow>

          <div className="sidebar-order-head">
            <div>
              <div className="switch-label">{t("sidebarOrderTitle")}</div>
              <div className="ui-control-description">{t("sidebarOrderHint")}</div>
            </div>
            <Popconfirm message={t("resetOrderConfirm")} onConfirm={resetNavConfig}>
              <Button>{t("resetOrder")}</Button>
            </Popconfirm>
          </div>
          <SidebarNavEditor
            value={navConfig}
            onChange={persistNavConfig}
            excludedKeys={new Set(plugins.filter((plugin) => !plugin.enabled).map((plugin) => plugin.route))}
          />
          </SettingsSection>
          }
          </div>
        </>
      )}

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
                              <div key={def.key} className={`plugin-slider-row${def.type === "multiselect" ? " plugin-slider-row--stacked" : ""}`}>
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
