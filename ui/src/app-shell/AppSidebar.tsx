import { useState } from "react";
import { NavLink } from "react-router-dom";
import { AlertTriangle, Check, ChevronDown, Download } from "lucide-react";
import type { DownloadSummary } from "../api";
import type { NavItem } from "../nav";
import { useI18n } from "../i18n";
import Tooltip from "../components/Tooltip";
import { Badge } from "../components/ui";
import SidebarPlaylists from "./SidebarPlaylists";
import SidebarSubscriptions from "./SidebarSubscriptions";

type AppSidebarProps = {
  downloadSummary: DownloadSummary;
  hiddenNavItems: NavItem[];
  liveCount: number;
  navItems: NavItem[];
  newCompletedDownloads: number;
};

export default function AppSidebar({
  downloadSummary,
  hiddenNavItems,
  liveCount,
  navItems,
  newCompletedDownloads,
}: AppSidebarProps) {
  const { t } = useI18n();
  const [showHidden, setShowHidden] = useState(false);

  const renderNavLink = (item: NavItem) => {
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
    <>
      <aside className="sidebar">
        {navItems.map(renderNavLink)}
        {hiddenNavItems.length > 0 && (
          <>
            <button
              className="nav-more"
              aria-label={showHidden ? t("showLess") : t("showMore")}
              aria-expanded={showHidden}
              onClick={() => setShowHidden((value) => !value)}
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
    </>
  );
}
