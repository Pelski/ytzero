import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import "./SettingsPage.css";
import { createPortal } from "react-dom";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, ArchiveRestore, ArrowRight, Check, CheckCircle2, ChevronDown, ChevronUp, Clock, Download, ExternalLink, Eye, EyeOff, FileText, Filter, FolderUp, GripVertical, Info, ListMinus, LoaderCircle, ListMusic, Pencil, Play, Plug, Plus, RefreshCw, RotateCcw, ShieldCheck, Sparkles, Trash2, Tv, UserMinus, UserPlus, UsersRound, Wrench, X, Zap } from "lucide-react";
import { api, type AppChangelog, type AppLogs, type AppLogStreamEvent, type AppVersion, type AuthMethod, type Channel, type ChannelManualStatus, type ChildLockStatus, type FilterRule, type FollowedPlaylist, type MembersOnlyVisibility, type PluginManifest, type PluginSettingsResponse, type Profile, type ProfilePermissionArea, type ProfilePermissions, type Rule, type ShortsFeedMode, type Tag, type UpdateCheck, type UserPlaylist, type UserPlaylistRule, type Video, SB_CATEGORIES, PLAYBACK_SPEEDS } from "../api";
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
import { applyVideoCardActionsMode, parseVideoCardActionsMode, type VideoCardActionsMode } from "../videoCardActions";
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


export function useSettingsPageController({ showToast }: { showToast: (message: string) => void }) {
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
  const [timeZoneLocked, setTimeZoneLocked] = useState(false);
  // App-wide settings (app name, icon color, timezone, child lock) are owned by the
  // primary profile; other profiles see them read-only.
  const [isPrimary, setIsPrimary] = useState(false);
  const [canManageAdministrators, setCanManageAdministrators] = useState(false);
  const [adminDelegationAvailable, setAdminDelegationAvailable] = useState(false);
  const [activeAuthMethod, setActiveAuthMethod] = useState<AuthMethod>("none");
  const [isChildProfile, setIsChildProfile] = useState<boolean | null>(null);
  const [shortsFeedMode, setShortsFeedMode] = useState<ShortsFeedMode>("0");
  const [showTopChannels, setShowTopChannels] = useState(true);
  const [hideLiveFromFeed, setHideLiveFromFeed] = useState(false);
  const [watchShowRelated, setWatchShowRelated] = useState(true);
  const [watchShowComments, setWatchShowComments] = useState(false), [channelPostsTab, setChannelPostsTab] = useState(false);
  const [feedMaxAgeValue, setFeedMaxAgeValue] = useState("6");
  const [feedMaxAgeUnit, setFeedMaxAgeUnit] = useState<FeedMaxAgeUnit>("months");
  const [feedAutoplayEnabled, setFeedAutoplayEnabled] = useState(false);
  const [feedAutoplayBehavior, setFeedAutoplayBehavior] = useState<"autoplay" | "prompt">("autoplay");
  const [feedAutoplayDirection, setFeedAutoplayDirection] = useState<"oldest" | "newest">("newest");
  const [membersOnlyVisibility, setMembersOnlyVisibility] = useState<MembersOnlyVisibility>("everywhere");
  const [watchedStyle, setWatchedStyle] = useState<WatchedStyle>("dimmed");
  const [videoCardActions, setVideoCardActions] = useState<VideoCardActionsMode>("hover");
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
      setTimeZoneLocked(Boolean(r.settings_meta?.timezone_locked));
      setUpdateCheckInterval(r.settings.update_check_interval || "off");
      setShortsFeedMode(r.settings.show_shorts === "1" || r.settings.show_shorts === "selected" ? r.settings.show_shorts : "0");
      setShowTopChannels(r.settings.show_top_channels !== "0");
      setHideLiveFromFeed(r.settings.hide_live_from_feed === "1");
      setWatchShowRelated(r.settings.watch_show_related !== "0");
      setWatchShowComments(r.settings.watch_show_comments === "1"); setChannelPostsTab(r.settings.channel_posts_tab === "1");
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
      setVideoCardActions(parseVideoCardActionsMode(r.settings.video_card_actions));
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

  const changeShortsFeedMode = async (next: ShortsFeedMode) => {
    const previous = shortsFeedMode;
    setShortsFeedMode(next);
    try {
      await api.updateSettings({ show_shorts: next });
      showToast(t("displaySettingsSaved"));
    } catch (error) {
      setShortsFeedMode(previous);
      showToast(error instanceof Error ? error.message : t("error"));
    }
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

  const toggleChannelPostsTab = async () => { const next = !channelPostsTab; setChannelPostsTab(next); await api.updateSettings({ channel_posts_tab: next ? "1" : "0" }); showToast(t("displaySettingsSaved")); };

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

  const changeVideoCardActions = async (next: VideoCardActionsMode) => {
    setVideoCardActions(next);
    applyVideoCardActionsMode(next);
    await api.updateSettings({ video_card_actions: next });
    emit("video-card-actions-changed");
    showToast(t("displaySettingsSaved"));
  };

  const changeVideoCardSize = (next: number) => {
    setVideoCardSize(next);
    persistVideoCardSize(next);
    applyVideoCardSize(next);
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


  return {
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
    channelCustomName, channelPostsTab,
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
    shortsFeedMode,
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
    timeZoneLocked,
    toggleAdminOnlyArea,
    toggleChannelFollow, toggleChannelPostsTab,
    toggleChannelTag,
    toggleFeedAutoplay,
    toggleLiveFromFeed,
    togglePlugin,
    toggleSb,
    toggleSbCategory,
    changeShortsFeedMode,
    toggleTopChannels,
    toggleWatchComments,
    toggleWatchRelated,
    unlockPin,
    unlockSettings,
    updateCheck,
    updateCheckError,
    updateCheckInterval,
    updatePluginBlockedTerms,
    updatePluginSetting,
    updatingChannelId,
    watchShowComments,
    watchShowRelated,
    watchedStyle,
    videoCardActions,
    changeVideoCardActions,
  };
}
