import { FormEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { subscribe, subscribeToast, emit, type ToastVariant } from "./events";
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, Check, ChevronDown, ChevronRight, Download, Menu, Play, Plus, RefreshCw, Search, Users } from "lucide-react";
import { api, type AppSettings, type AuthStatus, type ChildStatus, type DownloadSummary, type ProfilePermissions, type UserPlaylist, type Video } from "./api";
import ChildLockScreen from "./components/ChildLockScreen";
import LoginPage from "./pages/LoginPage";
import { splitNavItems, parseNavConfig, type NavConfigEntry } from "./nav";
import { img } from "./img";
import FeedPage from "./pages/FeedPage";
import SearchPage from "./pages/SearchPage";
import RecommendationsPage from "./pages/RecommendationsPage";
import LivePage from "./pages/LivePage";
import WatchlistPage from "./pages/WatchlistPage";
import HistoryPage from "./pages/HistoryPage";
import ArchivePage from "./pages/ArchivePage";
import SettingsPage from "./pages/SettingsPage";
import ImportPage from "./pages/ImportPage";
import WatchPage from "./pages/WatchPage";
import ChannelPage from "./pages/ChannelPage";
import UserPlaylistPage from "./pages/UserPlaylistPage";
import ChannelPlaylistPage from "./pages/ChannelPlaylistPage";
import FollowedPlaylistsPage from "./pages/FollowedPlaylistsPage";
import ShortsPage from "./pages/ShortsPage";
import DownloadsPage from "./pages/DownloadsPage";
import SubscriptionsPage from "./pages/SubscriptionsPage";
import LikedPage from "./pages/LikedPage";
import InsightsPage from "./pages/InsightsPage";
import CleanupPage from "./pages/CleanupPage";
import RestorePage from "./pages/RestorePage";
import { PlaylistIcon, PlaylistIconPicker } from "./components/PlaylistIcon";
import ProfileMenu from "./components/ProfileMenu";
import { useI18n } from "./i18n";
import { applyVideoCardSize } from "./videoCardSize";
import { AppNameContext } from "./useDocumentTitle";
import "./AppShell.css";

// Routes owned exclusively by plugins — visible only while enabled.
const PLUGIN_ROUTES = ["/recommendations"];
import { applyWatchedStyle, parseWatchedStyle } from "./watchedStyle";
import { VideoThumbnail, watchProgress } from "./components/VideoThumbnail";
import ChildNowWatching from "./components/ChildNowWatching";
import Tooltip from "./components/Tooltip";
import { Badge, Button, Toast } from "./components/ui";
import { ENHANCE_CONFIGURATION_ELEMENT_ID, serializeEnhanceConfiguration } from "./enhanceBridge";
import { subscribeServerEvent } from "./serverEvents";
import { queueSettingWrite } from "./settingsWriteQueue";
import { isIncognitoMode, setIncognitoAllowed, setIncognitoMode } from "./incognitoMode";
import { getNewCompletedDownloads, observeDownloadSummary } from "./downloadActivity";

type RecentChannel = { channel_id: string; title: string; thumbnail: string; latest_thumbnail: string | null; latest_video_id: string | null; watched: number; watch_position: number | null; watch_duration: number | null };

function SidebarSubscriptions() {
  const { t } = useI18n();
  const [channels, setChannels] = useState<RecentChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const visibleChannels = channels.slice(0, 5);

  const loadChannels = useCallback(() => {
    api.recentChannels().then((r) => { setChannels(r.channels); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  useEffect(loadChannels, [loadChannels]);
  useEffect(() => subscribe("channels-changed", loadChannels), [loadChannels]);

  return (
    <div className="sidebar-subs">
      <div className="sidebar-subs-header">{t("subscriptions")}</div>
      <NavLink to="/subscriptions" className={({ isActive }) => `sidebar-subs-compact${isActive ? " active" : ""}`}>
        <Users size={18} />
        <span>{t("subscriptions")}</span>
      </NavLink>
      <div className="sidebar-subs-list">
        {loading && channels.length === 0 && (
          <div className="sidebar-skeleton-list" aria-label={t("loading")}>
            {Array.from({ length: 5 }, (_, i) => (
              <div className="sidebar-skeleton-item" aria-hidden="true" key={i}>
                <div className="skeleton sidebar-skeleton-avatar" />
                <div className="skeleton skeleton-line" />
              </div>
            ))}
          </div>
        )}
        {visibleChannels.map((ch) => (
          <div key={ch.channel_id} className="sidebar-sub-item">
            <Link to={`/channel/${ch.channel_id}`} className="sidebar-sub-channel">
              {ch.thumbnail ? (
                <img className="sidebar-sub-avatar" src={img(ch.thumbnail)} alt="" />
              ) : (
                <div className="sidebar-sub-avatar" />
              )}
              <span className="sidebar-sub-name">{ch.title}</span>
            </Link>
            {ch.latest_thumbnail && ch.latest_video_id && (
              <Link to={`/watch/${ch.latest_video_id}`} className="sidebar-sub-video" aria-label={ch.title}>
                <VideoThumbnail src={img(ch.latest_thumbnail)} watched={ch.watched === 1} progress={watchProgress(ch.watch_position, ch.watch_duration)} variant="sidebar" />
              </Link>
            )}
          </div>
        ))}
        {!loading && channels.length > 0 && (
          <NavLink to="/subscriptions" className={({ isActive }) => `sidebar-show-more${isActive ? " active" : ""}`}>
            <span>{t("showMore")}</span>
            <ChevronRight size={15} />
          </NavLink>
        )}
      </div>
    </div>
  );
}

function SidebarPlaylists() {
  const { t } = useI18n();
  const [playlists, setPlaylists] = useState<UserPlaylist[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("ListMusic");
  const listRef = useRef<HTMLDivElement>(null);
  const [shadowTop, setShadowTop] = useState(false);
  const [shadowBot, setShadowBot] = useState(false);

  const load = useCallback(() => {
    api
      .userPlaylists()
      .then((r) => setPlaylists(r.playlists))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => subscribe("playlists-changed", load), [load]);

  const updateShadows = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    setShadowTop(el.scrollTop > 4);
    setShadowBot(el.scrollTop + el.clientHeight < el.scrollHeight - 4);
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    updateShadows();
    el.addEventListener("scroll", updateShadows, { passive: true });
    const ro = new ResizeObserver(updateShadows);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", updateShadows);
      ro.disconnect();
    };
  }, [playlists, loading, updateShadows]);

  const create = async () => {
    if (!name.trim()) return;
    await api.createUserPlaylist({ name: name.trim(), icon });
    setName("");
    setIcon("ListMusic");
    setCreating(false);
    load();
    emit("playlists-changed");
  };

  return (
    <div className="sidebar-playlists">
      <div className="sidebar-section-title">
        <span>{t("myPlaylists")}</span>
        <button className="sidebar-add-btn" title={t("newPlaylist")} onClick={() => setCreating((v) => !v)}>
          <Plus size={15} />
        </button>
      </div>
      <div className={`sidebar-playlists-scroll-wrap${shadowTop ? " shadow-top" : ""}${shadowBot ? " shadow-bot" : ""}`}>
        <div className="sidebar-playlists-scroll" ref={listRef}>
          {loading && playlists.length === 0 && (
            <div className="sidebar-skeleton-list" aria-label={t("loading")}>
              {Array.from({ length: 3 }, (_, i) => (
                <div className="sidebar-skeleton-item" aria-hidden="true" key={i}>
                  <div className="skeleton sidebar-skeleton-square" />
                  <div className="skeleton skeleton-line" />
                </div>
              ))}
            </div>
          )}
          {playlists.map((p) => (
            <NavLink key={p.id} to={`/playlists/${p.id}`} className={({ isActive }) => `sidebar-playlist-item${isActive ? " active" : ""}`}>
              <span className="sidebar-playlist-icon"><PlaylistIcon icon={p.icon} /></span>
              <span className="sidebar-sub-name">{p.name}</span>
              <span className="sidebar-playlist-count">{p.video_count}</span>
            </NavLink>
          ))}
        </div>
      </div>
      {creating && (
        <div className="sidebar-playlist-form">
          <div className="sidebar-playlist-fields">
            <PlaylistIconPicker value={icon} onChange={setIcon} compact />
            <input value={name} placeholder={t("playlistName")} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
          </div>
          <Button variant="primary" onClick={create} disabled={!name.trim()}>{t("create")}</Button>
        </div>
      )}
    </div>
  );
}

function SpyLogo() {
  return (
    <svg className="spy-logo" viewBox="0 0 32 32" aria-hidden="true">
      <path className="spy-logo__hat" d="M7 13.5 10.2 5h11.6l3.2 8.5" />
      <path className="spy-logo__band" d="M9 10.5h14" />
      <path className="spy-logo__brim" d="M3.5 14h25" />
      <circle className="spy-logo__lens" cx="10.5" cy="20.5" r="4" />
      <circle className="spy-logo__lens" cx="21.5" cy="20.5" r="4" />
      <path className="spy-logo__bridge" d="M14.5 20.5h3" />
      <path className="spy-logo__collar" d="m11.5 25.2 4.5 3.3 4.5-3.3" />
    </svg>
  );
}

function TopBar({ appName, appIconColor, isAdmin, isChildProfile, profilePermissions, feedSort, onFeedSortChange, incognito, onIncognitoChange }: {
  appName: string;
  appIconColor: string;
  isAdmin: boolean;
  isChildProfile: boolean;
  profilePermissions: ProfilePermissions;
  feedSort: "published" | "arrival";
  onFeedSortChange: (next: "published" | "arrival") => void;
  incognito: boolean;
  onIncognitoChange: (next: boolean) => void;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [solid, setSolid] = useState(window.scrollY > 8);
  const [feedRefreshing, setFeedRefreshing] = useState(false);
  const feedRefreshStartedAtRef = useRef(0);
  const feedRefreshFinishTimerRef = useRef<number | null>(null);

  useEffect(() => setQ(params.get("q") ?? ""), [params]);

  useEffect(() => {
    const onScroll = () => setSolid(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const unsubscribeStarted = subscribe("feed-refresh-started", () => {
      if (feedRefreshFinishTimerRef.current !== null) {
        window.clearTimeout(feedRefreshFinishTimerRef.current);
        feedRefreshFinishTimerRef.current = null;
      }
      feedRefreshStartedAtRef.current = performance.now();
      setFeedRefreshing(true);
    });
    const unsubscribeFinished = subscribe("feed-refresh-finished", () => {
      const elapsed = performance.now() - feedRefreshStartedAtRef.current;
      const remaining = Math.max(0, 2000 - elapsed);
      feedRefreshFinishTimerRef.current = window.setTimeout(() => {
        setFeedRefreshing(false);
        feedRefreshFinishTimerRef.current = null;
      }, remaining);
    });
    return () => {
      unsubscribeStarted();
      unsubscribeFinished();
      if (feedRefreshFinishTimerRef.current !== null) {
        window.clearTimeout(feedRefreshFinishTimerRef.current);
      }
    };
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    navigate(q.trim() ? `/search?q=${encodeURIComponent(q.trim())}` : "/");
  };

  return (
    <div
      className={`topbar${solid ? " topbar--solid" : ""}${incognito ? " topbar--incognito" : ""}${feedRefreshing ? " topbar--feed-refreshing" : ""}`}
      aria-busy={feedRefreshing}
    >
      <button
        className="sidebar-toggle-btn"
        aria-label="Menu"
        onClick={() => {
          const hidden = document.body.classList.toggle("sidebar-hidden");
          if (!window.matchMedia(MOBILE_SIDEBAR_QUERY).matches) {
            localStorage.setItem(SIDEBAR_KEY, hidden ? "0" : "1");
          }
        }}
      >
        <Menu size={20} />
      </button>
      <Link
        to="/"
        className="topbar-logo"
        onClick={(event) => {
          if (
            location.pathname === "/"
            && event.button === 0
            && !event.metaKey
            && !event.ctrlKey
            && !event.shiftKey
            && !event.altKey
          ) {
            event.preventDefault();
            emit("feed-view-reload-requested");
          }
        }}
      >
        <span className={`logo-mark${incognito ? " logo-mark--incognito" : ""}`} style={incognito ? undefined : { background: appIconColor }}>
          <span className="topbar-logo-default-icon">{incognito ? <SpyLogo /> : <Play fill="currentColor" />}</span>
          <RefreshCw className="topbar-logo-refresh-icon" aria-hidden="true" />
        </span>
        <span className="logo-text">{appName}</span>
      </Link>
      <span className="topbar-refresh-progress" aria-hidden="true" />
      <form className="search-wrap" onSubmit={submit}>
        <input
          placeholder={t("searchPlaceholder")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="submit" className="search-btn" aria-label={t("search")}>
          <Search />
        </button>
      </form>
      <ProfileMenu
        isAdmin={isAdmin}
        isChildProfile={isChildProfile}
        profilePermissions={profilePermissions}
        feedSort={feedSort}
        onFeedSortChange={onFeedSortChange}
        incognito={incognito}
        onIncognitoChange={onIncognitoChange}
      />
    </div>
  );
}

const SIDEBAR_KEY = "sidebar_open";
const MOBILE_SIDEBAR_QUERY = "(max-width: 760px)";

function AppBootstrap() {
  const { t } = useI18n();

  useLayoutEffect(() => {
    document.title = t("loading");
  }, [t]);

  return (
    <div className="app-bootstrap" role="status" aria-label={t("loading")}>
      <span className="app-bootstrap-mark" aria-hidden="true"><Play fill="currentColor" /></span>
    </div>
  );
}

export default function App() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);

  useEffect(() => {
    api.authStatus().then(setAuth).catch(() => setAuth({
      method: "none",
      authenticated: true,
      can_switch: true,
      hide_other_profiles: false,
      can_manage_administrators: false,
      admin_delegation_available: false,
    }));
  }, []);

  if (!auth) return <AppBootstrap />;
  if (!auth.authenticated) return <LoginPage status={auth} />;
  return <AppShell isAdmin={Boolean(auth.is_admin)} />;
}

function AppShell({ isAdmin }: { isAdmin: boolean }) {
  const { t, ready: i18nReady } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const [liveCount, setLiveCount] = useState(0);
  const [downloadSummary, setDownloadSummary] = useState<DownloadSummary>({ enabled: false, queued: 0, downloading: 0, completed: 0, errors: 0 });
  const [newCompletedDownloads, setNewCompletedDownloads] = useState(getNewCompletedDownloads);
  const [toast, setToast] = useState<{ message: string; variant: ToastVariant } | null>(null);
  const [showShorts, setShowShorts] = useState(false);
  const [appName, setAppName] = useState("YT Zero");
  const [appIconColor, setAppIconColor] = useState("#0a5fff");
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [navConfig, setNavConfig] = useState<NavConfigEntry[]>(() => parseNavConfig(null));
  const [enabledPluginRoutes, setEnabledPluginRoutes] = useState<Set<string> | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [childStatus, setChildStatus] = useState<ChildStatus | null>(null);
  const [incognito, setIncognito] = useState(isIncognitoMode);
  const [profilePermissions, setProfilePermissions] = useState<ProfilePermissions>({ admin_only_areas: ["channels", "followed_playlists", "imports", "appearance", "feed", "navigation", "playback", "plugins", "profiles"] });
  const [settingsReady, setSettingsReady] = useState(false);
  const [permissionsReady, setPermissionsReady] = useState(false);
  const [pluginsReady, setPluginsReady] = useState(false);
  const [childStatusReady, setChildStatusReady] = useState(false);
  const toastTimeoutRef = useRef<number | null>(null);
  const removingLegacyFeedSortRef = useRef(false);
  const downloadSummaryRequestRef = useRef(0);
  const downloadsPageActiveRef = useRef(location.pathname === "/downloads");

  const play = useCallback((v: Video) => navigate(`/watch/${v.video_id}`), [navigate]);

  const changeIncognito = useCallback((next: boolean) => {
    const allowed = childStatus?.is_child !== true;
    setIncognitoAllowed(allowed);
    setIncognitoMode(allowed && next);
    setIncognito(allowed && next);
  }, [childStatus?.is_child]);

  useEffect(() => {
    document.body.classList.toggle("incognito-mode", incognito);
    return () => document.body.classList.remove("incognito-mode");
  }, [incognito]);

  const showToast = useCallback((message: string, variant: ToastVariant = "default") => {
    if (toastTimeoutRef.current != null) window.clearTimeout(toastTimeoutRef.current);
    setToast({ message, variant });
    toastTimeoutRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimeoutRef.current = null;
    }, 3500);
  }, []);

  useEffect(() => subscribeToast(showToast), [showToast]);
  useEffect(() => () => {
    if (toastTimeoutRef.current != null) window.clearTimeout(toastTimeoutRef.current);
  }, []);

  useLayoutEffect(() => {
    const media = window.matchMedia(MOBILE_SIDEBAR_QUERY);
    const syncSidebar = () => {
      if (media.matches) document.body.classList.add("sidebar-hidden");
      else document.body.classList.toggle("sidebar-hidden", localStorage.getItem(SIDEBAR_KEY) === "0");
    };
    syncSidebar();
    media.addEventListener("change", syncSidebar);
    return () => media.removeEventListener("change", syncSidebar);
  }, []);

  useEffect(() => {
    if (window.matchMedia(MOBILE_SIDEBAR_QUERY).matches) document.body.classList.add("sidebar-hidden");
  }, [location.pathname]);

  const loadSettings = useCallback(() => {
    api.settings().then((r) => {
      setAppSettings(r.settings);
      setShowShorts(r.settings.show_shorts === "1");
      setAppName(r.settings.app_name || "YT Zero");
      setAppIconColor(r.settings.app_icon_color || "#0a5fff");
      applyVideoCardSize(r.settings.grid_size);
      emit("video-card-size-applied");
      applyWatchedStyle(parseWatchedStyle(r.settings.watched_style));
      const raw = r.settings.sidebar_nav;
      const navCfg = parseNavConfig(raw);
      if (!raw && r.settings.shorts_tab === "1") {
        const entry = navCfg.find((e) => e.key === "/shorts");
        if (entry) entry.hidden = false;
      }
      setNavConfig(navCfg);
    }).catch(() => {}).finally(() => setSettingsReady(true));
  }, []);

  const feedSort = appSettings?.feed_sort === "arrival" ? "arrival" : "published";
  const changeFeedSort = useCallback((next: "published" | "arrival") => {
    setAppSettings((current) => current ? { ...current, feed_sort: next } : current);
    queueSettingWrite("feed_sort", { feed_sort: next }, { onError: loadSettings });
    if (location.pathname === "/" && new URLSearchParams(location.search).has("sort")) {
      // Prevent the legacy URL migration effect from restoring `arrival`
      // between this state update and React Router removing the old parameter.
      removingLegacyFeedSortRef.current = true;
      const params = new URLSearchParams(location.search);
      params.delete("sort");
      navigate({ pathname: "/", search: params.toString() }, { replace: true });
    }
  }, [loadSettings, location.pathname, location.search, navigate]);

  // Preserve links created by the earlier URL-only implementation and migrate
  // their explicit arrival order into the profile preference.
  useEffect(() => {
    if (location.pathname !== "/" || !appSettings) return;
    const legacyArrival = new URLSearchParams(location.search).get("sort") === "arrival";
    if (!legacyArrival) {
      removingLegacyFeedSortRef.current = false;
      return;
    }
    if (removingLegacyFeedSortRef.current) {
      removingLegacyFeedSortRef.current = false;
      return;
    }
    if (feedSort !== "arrival") {
      changeFeedSort("arrival");
    }
  }, [location.pathname, location.search, appSettings, feedSort, changeFeedSort]);

  useEffect(loadSettings, [loadSettings]);
  useEffect(() => {
    api.profilePermissions()
      .then((result) => setProfilePermissions(result.permissions))
      .catch(() => {})
      .finally(() => setPermissionsReady(true));
  }, []);
  useEffect(() => subscribe("app-name-changed", loadSettings), [loadSettings]);
  useEffect(() => subscribe("sidebar-nav-changed", loadSettings), [loadSettings]);
  useEffect(() => subscribe("watched-style-changed", loadSettings), [loadSettings]);
  useEffect(() => subscribe("video-card-size-changed", loadSettings), [loadSettings]);
  useEffect(() => subscribe("player-settings-changed", loadSettings), [loadSettings]);

  const loadPlugins = useCallback(() => {
    api.plugins()
      .then((r) => {
        setEnabledPluginRoutes(new Set(r.plugins.filter((p) => p.enabled).map((p) => p.route)));
        // Thumbnail download-progress bars are toggled by a plugin setting;
        // a root attribute lets CSS hide them without prop-drilling.
        api.downloadConfig()
          .then((config) => { document.documentElement.dataset.dlThumbProgress = config.enabled ? String(config.settings.thumb_progress ?? 1) : "0"; })
          .catch(() => { document.documentElement.dataset.dlThumbProgress = "0"; });
      })
      .catch(() => setEnabledPluginRoutes(new Set()))
      .finally(() => setPluginsReady(true));
  }, []);

  useEffect(loadPlugins, [loadPlugins]);
  useEffect(() => subscribe("plugins-changed", loadPlugins), [loadPlugins]);
  useEffect(() => {
    if (!enabledPluginRoutes) return;
    if (PLUGIN_ROUTES.includes(location.pathname) && !enabledPluginRoutes.has(location.pathname)) {
      navigate("/", { replace: true });
    }
  }, [enabledPluginRoutes, location.pathname, navigate]);

  // Re-skin the tab favicon live (the OS-cached PWA icon only refreshes on reinstall).
  useEffect(() => {
    const href = `/favicon.svg?color=${encodeURIComponent(appIconColor)}`;
    // Keep the iOS install icon as a real PNG. Safari does not reliably use
    // SVG or data URLs for apple-touch-icon.
    document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]').forEach((l) => { l.href = href; });
  }, [appIconColor]);

  useEffect(() => {
    const load = () =>
      api
        .live()
        .then((r) => setLiveCount(r.videos.filter((v) => v.live_status === "live").length))
        .catch(() => {});
    load();
    return subscribeServerEvent("live", load);
  }, []);

  const loadDownloadSummary = useCallback(() => {
    const request = ++downloadSummaryRequestRef.current;
    api.downloadSummary().then((summary) => {
      if (request !== downloadSummaryRequestRef.current) return;
      setDownloadSummary(summary);
      setNewCompletedDownloads(observeDownloadSummary(summary.completed, downloadsPageActiveRef.current));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    loadDownloadSummary();
    return subscribeServerEvent("downloads", loadDownloadSummary);
  }, [loadDownloadSummary]);
  useEffect(() => subscribe("plugins-changed", loadDownloadSummary), [loadDownloadSummary]);
  useEffect(() => {
    downloadsPageActiveRef.current = location.pathname === "/downloads";
    if (!downloadsPageActiveRef.current) return;
    setNewCompletedDownloads(observeDownloadSummary(downloadSummary.completed, true));
    loadDownloadSummary();
  }, [location.pathname, loadDownloadSummary]);

  // Child watch-time and parent stop/grant changes arrive through the shared
  // application event stream; profile switches still reload the whole page.
  useEffect(() => {
    const load = () => {
      api.childStatus().then((s) => {
        setIncognitoAllowed(!s.is_child);
        setChildStatus(s);
        setIncognito(isIncognitoMode());
      }).catch(() => {}).finally(() => setChildStatusReady(true));
    };
    load();
  }, []);

  useEffect(() => {
    if (!childStatus?.is_child) return;
    if (incognito) changeIncognito(false);
    const load = () => { api.childStatus().then(setChildStatus).catch(() => {}); };
    return subscribeServerEvent("child-status", load);
  }, [childStatus?.is_child, incognito, changeIncognito]);

  // When the limit kicks in mid-video, leave the player page so playback stops
  // (the lock overlay alone would keep the audio running underneath).
  useEffect(() => {
    if (childStatus?.locked && (location.pathname.startsWith("/watch/") || location.pathname.startsWith("/shorts"))) {
      navigate("/", { replace: true });
    }
  }, [childStatus?.locked, location.pathname, navigate]);

  useEffect(() => {
    if (childStatus?.hide_live && location.pathname === "/live") {
      navigate("/", { replace: true });
    }
  }, [childStatus?.hide_live, location.pathname, navigate]);

  useEffect(() => {
    if (childStatus?.hide_shorts && location.pathname.startsWith("/shorts")) {
      navigate("/", { replace: true });
    }
  }, [childStatus?.hide_shorts, location.pathname, navigate]);

  useEffect(() => {
    if (childStatus?.is_child && location.pathname === "/insights") {
      navigate("/", { replace: true });
    }
  }, [childStatus?.is_child, location.pathname, navigate]);

  if (!i18nReady || !settingsReady || !permissionsReady || !pluginsReady || !childStatusReady) {
    return <AppBootstrap />;
  }

  const { visible: allNavItems, hidden: allHiddenNavItems } = splitNavItems(navConfig);
  const pluginRouteVisible = (to: string) => !PLUGIN_ROUTES.includes(to) || enabledPluginRoutes?.has(to);
  const childRouteVisible = (to: string) =>
    !(childStatus?.hide_shorts && to === "/shorts")
    && !(childStatus?.hide_live && to === "/live")
    && !(childStatus?.is_child && (to === "/downloads" || to === "/insights"));
  const navItems = allNavItems.filter((item) => pluginRouteVisible(item.to) && childRouteVisible(item.to));
  const hiddenNavItems = allHiddenNavItems.filter((item) => pluginRouteVisible(item.to) && childRouteVisible(item.to));

  const renderNavLink = (item: (typeof navItems)[number]) => {
    const Icon = item.icon;
    const activeDownloads = downloadSummary.queued + downloadSummary.downloading;
    const downloadIndicator = downloadSummary.errors > 0
      ? { kind: "error", count: downloadSummary.errors, icon: <AlertTriangle aria-hidden="true" /> }
      : activeDownloads > 0
        ? { kind: "active", count: activeDownloads, icon: <Download aria-hidden="true" /> }
        : newCompletedDownloads > 0
          ? { kind: "new", count: newCompletedDownloads, icon: <Check aria-hidden="true" /> }
          : null;
    const downloadTooltip = t("downloadsBadgeDetails", {
      downloading: downloadSummary.downloading,
      queued: downloadSummary.queued,
      completed: downloadSummary.completed,
      errors: downloadSummary.errors,
    });
    return (
      <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
        <Icon />
        <span className="nav-label">{t(item.labelKey)}</span>
        {item.to === "/live" && liveCount > 0 && <Badge variant="danger" size="sm" className="badge nav-live-badge">{liveCount}</Badge>}
        {item.to === "/downloads" && downloadSummary.enabled && downloadIndicator && (
          <Tooltip text={downloadTooltip} pos="right" className="nav-download-tooltip" portal>
            <Badge
              variant={downloadIndicator.kind === "error" ? "danger" : "accent"}
              size="sm"
              className={`badge nav-download-badge nav-download-badge--${downloadIndicator.kind}`}
              aria-label={downloadTooltip}
            >
              {downloadIndicator.icon}
              <span>{downloadIndicator.count > 99 ? "99+" : downloadIndicator.count}</span>
            </Badge>
          </Tooltip>
        )}
      </NavLink>
    );
  };

  return (
    <AppNameContext.Provider value={appName}>
    {appSettings && (
      <script id={ENHANCE_CONFIGURATION_ELEMENT_ID} type="application/json">
        {serializeEnhanceConfiguration(appSettings)}
      </script>
    )}
    <div className="layout">
      <TopBar
        appName={appName}
        appIconColor={appIconColor}
        isAdmin={isAdmin}
        isChildProfile={childStatus?.is_child === true}
        profilePermissions={profilePermissions}
        feedSort={feedSort}
        onFeedSortChange={changeFeedSort}
        incognito={incognito}
        onIncognitoChange={changeIncognito}
      />
      <div className="layout-body">
        <aside className="sidebar">
          {navItems.map(renderNavLink)}
          {hiddenNavItems.length > 0 && (
            <>
              <button
                className="nav-more"
                aria-label={showHidden ? t("showLess") : t("showMore")}
                aria-expanded={showHidden}
                onClick={() => setShowHidden((v) => !v)}
              >
                <ChevronDown className={`nav-more-chevron${showHidden ? " open" : ""}`} />
              </button>
              {showHidden && hiddenNavItems.map(renderNavLink)}
            </>
          )}
          <SidebarSubscriptions />
          <SidebarPlaylists />
        </aside>
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label={t("close")}
          onClick={() => document.body.classList.add("sidebar-hidden")}
        />
        <main className="main">
          <div className="content">
            <Routes>
              <Route path="/" element={<FeedPage onPlay={play} showToast={showToast} feedSort={feedSort} />} />
              <Route path="/search" element={<SearchPage onPlay={play} hideExternalSearch={childStatus?.local_only ?? false} />} />
              <Route path="/recommendations" element={enabledPluginRoutes?.has("/recommendations")
                ? <RecommendationsPage onPlay={play} loadRecommendations={api.recommendations} />
                : <Navigate to="/" replace />} />
              <Route path="/discovery" element={<Navigate to="/recommendations" replace />} />
              <Route path="/shorts" element={<ShortsPage />} />
              <Route path="/shorts/:videoId" element={<ShortsPage />} />
              <Route path="/live" element={<LivePage onPlay={play} />} />
              <Route path="/watch/:id" element={<WatchPage />} />
              <Route path="/watch/:id/playlist/:playlistId" element={<WatchPage />} />
              <Route path="/channel/:id" element={<ChannelPage onPlay={play} />} />
              <Route path="/subscriptions" element={<SubscriptionsPage />} />
              <Route path="/playlists/:id" element={<UserPlaylistPage onPlay={play} />} />
              <Route path="/playlist/:id" element={<ChannelPlaylistPage />} />
              <Route path="/followed-playlists" element={<FollowedPlaylistsPage />} />
              <Route path="/watchlist" element={<WatchlistPage />} />
              <Route path="/downloads" element={<DownloadsPage />} />
              <Route path="/liked" element={<LikedPage onPlay={play} />} />
              <Route path="/history" element={<HistoryPage onPlay={play} allowHistoryDeletion={childStatus?.is_child !== true} />} />
              <Route path="/archive" element={<ArchivePage onPlay={play} />} />
              <Route path="/cleanup" element={<CleanupPage />} />
              <Route path="/insights" element={<InsightsPage />} />
              <Route path="/settings" element={<SettingsPage showToast={showToast} />} />
              <Route path="/import" element={isAdmin || !profilePermissions.admin_only_areas.includes("imports") ? <ImportPage showToast={showToast} /> : <Navigate to="/settings" replace />} />
              <Route path="/restore" element={isAdmin ? <RestorePage showToast={showToast} /> : <Navigate to="/settings" replace />} />
            </Routes>
          </div>
        </main>
      </div>
      {toast && <Toast message={toast.message} variant={toast.variant} />}
      <ChildNowWatching />
      {childStatus?.locked && <ChildLockScreen status={childStatus} />}
    </div>
    </AppNameContext.Provider>
  );
}
