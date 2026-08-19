import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { type Video } from "../api";
import AppRoutes from "../AppRoutes";
import ChildLockScreen from "../components/ChildLockScreen";
import ChildNowWatching from "../components/ChildNowWatching";
import { Toast } from "../components/ui";
import { DeArrowProvider } from "../dearrow";
import { ENHANCE_CONFIGURATION_ELEMENT_ID, serializeEnhanceConfiguration } from "../enhanceBridge";
import { splitNavItems } from "../nav";
import type { PlaybackQueueContext } from "../playbackQueue";
import { AppNameContext } from "../useDocumentTitle";
import AppBootstrap from "./AppBootstrap";
import AppSidebar from "./AppSidebar";
import AppTopBar from "./AppTopBar";
import { useAppPreferences } from "./useAppPreferences";
import { useAppToast } from "./useAppToast";
import { useNavigationActivity } from "./useNavigationActivity";
import { usePluginRoutes } from "./usePluginRoutes";
import { useProfileSession } from "./useProfileSession";
import { useSidebarVisibility } from "./sidebarVisibility";
import { useI18n } from "../i18n";
import "../AppShell.css";

export default function AppShell({ isAdmin }: { isAdmin: boolean }) {
  const { ready: i18nReady } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const preferences = useAppPreferences();
  const plugins = usePluginRoutes();
  const profile = useProfileSession();
  const activity = useNavigationActivity();
  const { showToast, toast } = useAppToast();

  useSidebarVisibility(location.pathname);

  const play = useCallback((video: Video, playbackQueue?: PlaybackQueueContext) => navigate(
    `/watch/${video.video_id}`,
    playbackQueue ? { state: { playbackQueue } } : undefined,
  ), [navigate]);

  if (!i18nReady || !preferences.ready || !plugins.ready || !profile.ready) {
    return <AppBootstrap />;
  }

  const { visible: allNavItems, hidden: allHiddenNavItems } = splitNavItems(preferences.navConfig);
  const shortsEnabled = preferences.appSettings?.show_shorts !== "disabled";
  const pluginRouteVisible = (path: string) => !plugins.knownPluginRoutes.has(path) || plugins.enabledPluginRoutes?.has(path);
  const childRouteVisible = (path: string) =>
    !(profile.childStatus?.hide_shorts && path === "/shorts")
    && !(profile.childStatus?.hide_live && path === "/live")
    && !(profile.childStatus?.is_child && (path === "/downloads" || path === "/insights"));
  const shortsRouteVisible = (path: string) => shortsEnabled || path !== "/shorts";
  const navItems = allNavItems.filter((item) => pluginRouteVisible(item.to) && childRouteVisible(item.to) && shortsRouteVisible(item.to));
  const hiddenNavItems = allHiddenNavItems.filter((item) => pluginRouteVisible(item.to) && childRouteVisible(item.to) && shortsRouteVisible(item.to));

  return (
    <AppNameContext.Provider value={preferences.appName}>
      <DeArrowProvider
        titlesEnabled={preferences.appSettings?.dearrow_titles_enabled === "1"}
        thumbnailsEnabled={preferences.appSettings?.dearrow_thumbnails_enabled === "1"}
      >
        {preferences.appSettings && (
          <script id={ENHANCE_CONFIGURATION_ELEMENT_ID} type="application/json">
            {serializeEnhanceConfiguration(preferences.appSettings)}
          </script>
        )}
        <div className="layout">
          <AppTopBar
            appName={preferences.appName}
            appIconColor={preferences.appIconColor}
            isAdmin={isAdmin}
            isChildProfile={profile.childStatus?.is_child === true}
            profilePermissions={preferences.profilePermissions}
            feedSort={preferences.feedSort}
            onFeedSortChange={preferences.changeFeedSort}
            incognito={profile.incognito}
            onIncognitoChange={profile.changeIncognito}
          />
          <div className="layout-body">
            <AppSidebar
              downloadSummary={activity.downloadSummary}
              hiddenNavItems={hiddenNavItems}
              liveCount={activity.liveCount}
              navItems={navItems}
              newCompletedDownloads={activity.newCompletedDownloads}
            />
            <main className="main">
              <div className="content">
                <AppRoutes childStatus={profile.childStatus}
                  enabledPluginRoutes={plugins.enabledPluginRoutes}
                  feedSort={preferences.feedSort}
                  isAdmin={isAdmin}
                  onPlay={play}
                  profilePermissions={preferences.profilePermissions}
                  shortsEnabled={shortsEnabled}
                  showTopChannels={preferences.appSettings?.show_top_channels !== "0"}
                  showToast={showToast}
                />
              </div>
            </main>
          </div>
          {toast && <Toast message={toast.message} variant={toast.variant} />}
          {preferences.appSettings && preferences.appSettings.child_watching_monitor_enabled !== "0" && <ChildNowWatching />}
          {profile.childStatus?.locked && <ChildLockScreen status={profile.childStatus} />}
        </div>
      </DeArrowProvider>
    </AppNameContext.Provider>
  );
}
