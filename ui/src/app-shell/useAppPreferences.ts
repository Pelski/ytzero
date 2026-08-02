import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, type AppSettings, type ProfilePermissions } from "../api";
import { emit, subscribe } from "../events";
import { parseNavConfig, type NavConfigEntry } from "../nav";
import { queueSettingWrite } from "../settingsWriteQueue";
import { applyVideoCardSize } from "../videoCardSize";
import { applyWatchedStyle, parseWatchedStyle } from "../watchedStyle";

const DEFAULT_PROFILE_PERMISSIONS: ProfilePermissions = {
  admin_only_areas: ["channels", "followed_playlists", "imports", "appearance", "feed", "navigation", "playback", "plugins", "profiles"],
};

export function useAppPreferences() {
  const location = useLocation();
  const navigate = useNavigate();
  const [appName, setAppName] = useState("YT Zero");
  const [appIconColor, setAppIconColor] = useState("#0a5fff");
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [navConfig, setNavConfig] = useState<NavConfigEntry[]>(() => parseNavConfig(null));
  const [profilePermissions, setProfilePermissions] = useState<ProfilePermissions>(DEFAULT_PROFILE_PERMISSIONS);
  const [settingsReady, setSettingsReady] = useState(false);
  const [permissionsReady, setPermissionsReady] = useState(false);
  const removingLegacyFeedSortRef = useRef(false);

  const loadSettings = useCallback(() => {
    api.settings().then((result) => {
      const settings = result.settings;
      setAppSettings(settings);
      setAppName(settings.app_name || "YT Zero");
      setAppIconColor(settings.app_icon_color || "#0a5fff");
      applyVideoCardSize(settings.grid_size);
      emit("video-card-size-applied");
      applyWatchedStyle(parseWatchedStyle(settings.watched_style));

      const rawNavConfig = settings.sidebar_nav;
      const nextNavConfig = parseNavConfig(rawNavConfig);
      if (!rawNavConfig && settings.shorts_tab === "1") {
        const shortsEntry = nextNavConfig.find((entry) => entry.key === "/shorts");
        if (shortsEntry) shortsEntry.hidden = false;
      }
      setNavConfig(nextNavConfig);
    }).catch(() => {}).finally(() => setSettingsReady(true));
  }, []);

  const feedSort: "published" | "arrival" = appSettings?.feed_sort === "arrival" ? "arrival" : "published";
  const changeFeedSort = useCallback((next: "published" | "arrival") => {
    setAppSettings((current) => current ? { ...current, feed_sort: next } : current);
    queueSettingWrite("feed_sort", { feed_sort: next }, { onError: loadSettings });
    if (location.pathname === "/" && new URLSearchParams(location.search).has("sort")) {
      removingLegacyFeedSortRef.current = true;
      const params = new URLSearchParams(location.search);
      params.delete("sort");
      navigate({ pathname: "/", search: params.toString() }, { replace: true });
    }
  }, [loadSettings, location.pathname, location.search, navigate]);

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
    if (feedSort !== "arrival") changeFeedSort("arrival");
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
  useEffect(() => subscribe("child-watching-settings-changed", loadSettings), [loadSettings]);

  useEffect(() => {
    const href = `/favicon.svg?color=${encodeURIComponent(appIconColor)}`;
    document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]').forEach((link) => { link.href = href; });
  }, [appIconColor]);

  return {
    appIconColor,
    appName,
    appSettings,
    changeFeedSort,
    feedSort,
    navConfig,
    profilePermissions,
    ready: settingsReady && permissionsReady,
  };
}
