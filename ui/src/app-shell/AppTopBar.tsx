import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Menu, Play, RefreshCw, Search } from "lucide-react";
import type { ProfilePermissions } from "../api";
import { emit, subscribe } from "../events";
import ProfileMenu from "../components/ProfileMenu";
import { useI18n } from "../i18n";
import { toggleSidebar } from "./sidebarVisibility";

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

type AppTopBarProps = {
  appName: string;
  appIconColor: string;
  isAdmin: boolean;
  isChildProfile: boolean;
  profilePermissions: ProfilePermissions;
  feedSort: "published" | "arrival";
  onFeedSortChange: (next: "published" | "arrival") => void;
  incognito: boolean;
  onIncognitoChange: (next: boolean) => void;
};

export default function AppTopBar({
  appName,
  appIconColor,
  isAdmin,
  isChildProfile,
  profilePermissions,
  feedSort,
  onFeedSortChange,
  incognito,
  onIncognitoChange,
}: AppTopBarProps) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [solid, setSolid] = useState(window.scrollY > 8);
  const [feedRefreshing, setFeedRefreshing] = useState(false);
  const feedRefreshStartedAtRef = useRef(0);
  const feedRefreshFinishTimerRef = useRef<number | null>(null);
  const scrollAfterFeedRefreshRef = useRef(false);

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
      if (scrollAfterFeedRefreshRef.current) {
        scrollAfterFeedRefreshRef.current = false;
        window.scrollTo({
          top: 0,
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        });
      }
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

  const submit = (event: FormEvent) => {
    event.preventDefault();
    navigate(q.trim() ? `/search?q=${encodeURIComponent(q.trim())}` : "/");
  };

  return (
    <div
      className={`topbar${solid ? " topbar--solid" : ""}${incognito ? " topbar--incognito" : ""}${feedRefreshing ? " topbar--feed-refreshing" : ""}`}
      aria-busy={feedRefreshing}
    >
      <button className="sidebar-toggle-btn" aria-label="Menu" onClick={toggleSidebar}>
        <Menu size={20} />
      </button>
      <Link
        to="/"
        className="topbar-logo"
        onClick={(event) => {
          const plainLeftClick = event.button === 0
            && !event.metaKey
            && !event.ctrlKey
            && !event.shiftKey
            && !event.altKey;
          if (!plainLeftClick) return;

          if (location.pathname === "/") {
            event.preventDefault();
            scrollAfterFeedRefreshRef.current = true;
            emit("feed-view-reload-requested");
            return;
          }

          window.scrollTo({
            top: 0,
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
          });
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
        <input placeholder={t("searchPlaceholder")} value={q} onChange={(event) => setQ(event.target.value)} />
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
