import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { subscribe, emit } from "./events";
import { Link, NavLink, Route, Routes, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ChevronDown, ChevronRight, Menu, Play, Plus, Search, Users } from "lucide-react";
import { api, type AuthStatus, type UserPlaylist, type Video } from "./api";
import LoginPage from "./pages/LoginPage";
import { splitNavItems, parseNavConfig, type NavConfigEntry } from "./nav";
import { img } from "./img";
import FeedPage from "./pages/FeedPage";
import DiscoveryPage from "./pages/DiscoveryPage";
import LivePage from "./pages/LivePage";
import WatchlistPage from "./pages/WatchlistPage";
import HistoryPage from "./pages/HistoryPage";
import ArchivePage from "./pages/ArchivePage";
import SettingsPage from "./pages/SettingsPage";
import WatchPage from "./pages/WatchPage";
import ChannelPage from "./pages/ChannelPage";
import UserPlaylistPage from "./pages/UserPlaylistPage";
import ShortsPage from "./pages/ShortsPage";
import SubscriptionsPage from "./pages/SubscriptionsPage";
import LikedPage from "./pages/LikedPage";
import { PlaylistIcon, PlaylistIconPicker } from "./components/PlaylistIcon";
import ProfileMenu from "./components/ProfileMenu";
import { useI18n } from "./i18n";
import { applyWatchedStyle, parseWatchedStyle } from "./watchedStyle";
import { VideoThumbnail } from "./components/VideoThumbnail";

type RecentChannel = { channel_id: string; title: string; thumbnail: string; latest_thumbnail: string | null; latest_video_id: string | null; watched: number };

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
                <VideoThumbnail src={img(ch.latest_thumbnail)} watched={ch.watched === 1} variant="sidebar" />
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
          <button className="btn primary" onClick={create} disabled={!name.trim()}>{t("create")}</button>
        </div>
      )}
    </div>
  );
}

function TopBar({ appName, appIconColor }: { appName: string; appIconColor: string }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [solid, setSolid] = useState(window.scrollY > 8);

  useEffect(() => setQ(params.get("q") ?? ""), [params]);

  useEffect(() => {
    const onScroll = () => setSolid(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    navigate(q.trim() ? `/?q=${encodeURIComponent(q.trim())}` : "/");
  };

  return (
    <div className={`topbar${solid ? " topbar--solid" : ""}`}>
      <button
        className="sidebar-toggle-btn"
        aria-label="Menu"
        onClick={() => {
          const hidden = document.body.classList.toggle("sidebar-hidden");
          localStorage.setItem(SIDEBAR_KEY, hidden ? "0" : "1");
        }}
      >
        <Menu size={20} />
      </button>
      <Link to="/" className="topbar-logo">
        <span className="logo-mark" style={{ background: appIconColor }}>
          <Play fill="currentColor" />
        </span>
        <span className="logo-text">{appName}</span>
      </Link>
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
      <ProfileMenu />
    </div>
  );
}

const SIDEBAR_KEY = "sidebar_open";

export default function App() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);

  useEffect(() => {
    api.authStatus().then(setAuth).catch(() => setAuth({ method: "none", authenticated: true, can_switch: true }));
  }, []);

  if (!auth) return null; // brief: deciding app vs. login
  if (!auth.authenticated) return <LoginPage status={auth} />;
  return <AppShell />;
}

function AppShell() {
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const [liveCount, setLiveCount] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [showShorts, setShowShorts] = useState(false);
  const [appName, setAppName] = useState("YT Zero");
  const [appIconColor, setAppIconColor] = useState("#f2293a");
  const [navConfig, setNavConfig] = useState<NavConfigEntry[]>(() => parseNavConfig(null));
  const [enabledPluginRoutes, setEnabledPluginRoutes] = useState<Set<string> | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  const play = useCallback((v: Video) => navigate(`/watch/${v.video_id}`), [navigate]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem(SIDEBAR_KEY);
    if (saved === "0") document.body.classList.add("sidebar-hidden");
  }, []);

  const loadSettings = useCallback(() => {
    api.settings().then((r) => {
      setShowShorts(r.settings.show_shorts === "1");
      setAppName(r.settings.app_name || "YT Zero");
      setAppIconColor(r.settings.app_icon_color || "#f2293a");
      applyWatchedStyle(parseWatchedStyle(r.settings.watched_style));
      const raw = r.settings.sidebar_nav;
      const navCfg = parseNavConfig(raw);
      if (!raw && r.settings.shorts_tab === "1") {
        const entry = navCfg.find((e) => e.key === "/shorts");
        if (entry) entry.hidden = false;
      }
      setNavConfig(navCfg);
    }).catch(() => {});
  }, []);

  useEffect(loadSettings, [loadSettings]);
  useEffect(() => subscribe("app-name-changed", loadSettings), [loadSettings]);
  useEffect(() => subscribe("sidebar-nav-changed", loadSettings), [loadSettings]);
  useEffect(() => subscribe("watched-style-changed", loadSettings), [loadSettings]);

  const loadPlugins = useCallback(() => {
    api.plugins()
      .then((r) => setEnabledPluginRoutes(new Set(r.plugins.filter((p) => p.enabled).map((p) => p.route))))
      .catch(() => setEnabledPluginRoutes(new Set()));
  }, []);

  useEffect(loadPlugins, [loadPlugins]);
  useEffect(() => subscribe("plugins-changed", loadPlugins), [loadPlugins]);
  useEffect(() => {
    if (!enabledPluginRoutes) return;
    if (location.pathname === "/discovery" && !enabledPluginRoutes.has("/discovery")) navigate("/", { replace: true });
  }, [enabledPluginRoutes, location.pathname, navigate]);

  useEffect(() => {
    if (!location.pathname.startsWith("/watch/")) document.title = appName;
  }, [appName, location.pathname]);

  // Re-skin the tab favicon live (the OS-cached PWA icon only refreshes on reinstall).
  useEffect(() => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="${appIconColor}"/><polygon points="192,160 384,256 192,352" fill="#fff"/></svg>`;
    const href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    document.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="apple-touch-icon"]').forEach((l) => { l.href = href; });
  }, [appIconColor]);

  useEffect(() => {
    const load = () =>
      api
        .live()
        .then((r) => setLiveCount(r.videos.filter((v) => v.live_status === "live").length))
        .catch(() => {});
    load();
    const t = setInterval(load, 120_000);
    return () => clearInterval(t);
  }, []);

  const { visible: allNavItems, hidden: allHiddenNavItems } = splitNavItems(navConfig);
  const pluginRouteVisible = (to: string) => to !== "/discovery" || enabledPluginRoutes?.has(to);
  const navItems = allNavItems.filter((item) => pluginRouteVisible(item.to));
  const hiddenNavItems = allHiddenNavItems.filter((item) => pluginRouteVisible(item.to));

  const renderNavLink = (item: (typeof navItems)[number]) => {
    const Icon = item.icon;
    return (
      <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
        <Icon />
        <span className="nav-label">{t(item.labelKey)}</span>
        {item.to === "/live" && liveCount > 0 && <span className="badge">{liveCount}</span>}
      </NavLink>
    );
  };

  return (
    <div className="layout">
      <TopBar appName={appName} appIconColor={appIconColor} />
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
        <main className="main">
          <div className="content">
            <Routes>
              <Route path="/" element={<FeedPage onPlay={play} showToast={showToast} />} />
              <Route path="/discovery" element={<DiscoveryPage onPlay={play} />} />
              <Route path="/shorts" element={<ShortsPage />} />
              <Route path="/live" element={<LivePage onPlay={play} />} />
              <Route path="/watch/:id" element={<WatchPage />} />
              <Route path="/watch/:id/playlist/:playlistId" element={<WatchPage />} />
              <Route path="/channel/:id" element={<ChannelPage onPlay={play} />} />
              <Route path="/subscriptions" element={<SubscriptionsPage />} />
              <Route path="/playlists/:id" element={<UserPlaylistPage onPlay={play} />} />
              <Route path="/watchlist" element={<WatchlistPage />} />
              <Route path="/liked" element={<LikedPage onPlay={play} />} />
              <Route path="/history" element={<HistoryPage onPlay={play} />} />
              <Route path="/archive" element={<ArchivePage onPlay={play} />} />
              <Route path="/settings" element={<SettingsPage showToast={showToast} />} />
            </Routes>
          </div>
        </main>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
