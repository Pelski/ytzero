import type { I18nKey } from "../../i18n";

export interface SettingsSearchEntry {
  id: string;
  view: string;
  label: string;
  description?: string;
  section: string;
  pluginId?: string;
  settingKey?: string;
}

type Translate = (key: I18nKey) => string;
type CatalogEntry = { view: string; label: I18nKey; description?: I18nKey };

const CATALOG: CatalogEntry[] = [
  { view: "display", label: "appNameLabel" },
  { view: "display", label: "appIconColorLabel" },
  { view: "display", label: "timeZoneLabel", description: "timeZoneHint" },
  { view: "display", label: "uiLanguage" },
  { view: "display", label: "watchedStyleLabel", description: "watchedStyleHint" },
  { view: "display:feed", label: "hideLiveFromFeed", description: "hideLiveFromFeedHint" },
  { view: "display:feed", label: "showShorts", description: "showShortsHint" },
  { view: "display:feed", label: "feedMaxAge", description: "feedMaxAgeHint" },
  { view: "display:feed", label: "membersOnlyVisibility", description: "membersOnlyVisibilityHint" },
  { view: "display:playback", label: "watchShowRelated", description: "watchShowRelatedHint" },
  { view: "display:playback", label: "watchShowComments", description: "watchShowCommentsHint" },
  { view: "display:playback", label: "feedAutoplay", description: "feedAutoplayHint" },
  { view: "display:playback", label: "feedAutoplayBehavior", description: "feedAutoplayBehaviorHint" },
  { view: "display:playback", label: "feedAutoplayDirection", description: "feedAutoplayDirectionHint" },
  { view: "display:playback", label: "quality", description: "qualityHint" },
  { view: "display:playback", label: "playbackSpeed", description: "playbackSpeedHint" },
  { view: "display:playback", label: "keyboardSeekSeconds", description: "keyboardSeekSecondsHint" },
  { view: "display:playback", label: "autoFullscreenLandscape", description: "autoFullscreenLandscapeHint" },
  { view: "display:subtitles", label: "forceCaptions", description: "forceCaptionsHint" },
  { view: "display:subtitles", label: "playerLanguage" },
  { view: "display:subtitles", label: "subtitleStyleTitle", description: "subtitleStyleHint" },
  { view: "display:screenshots", label: "playerScreenshotFormat", description: "playerScreenshotFormatHint" },
  { view: "display:screenshots", label: "playerScreenshotQuality" },
  { view: "display:screenshots", label: "playerScreenshotFilename", description: "playerScreenshotFilenameHint" },
  { view: "display:privacy", label: "dearrowTitlesEnabled", description: "dearrowTitlesHint" },
  { view: "display:privacy", label: "dearrowThumbnailsEnabled", description: "dearrowThumbnailsHint" },
  { view: "display:privacy", label: "sponsorblockEnabled", description: "sponsorblockHint" },
  { view: "display:privacy", label: "sponsorblockCategories" },
  { view: "display:navigation", label: "showTopChannels", description: "showTopChannelsHint" },
  { view: "display:navigation", label: "itemOrder", description: "itemOrderHint" },
  { view: "profiles", label: "childWatchingMonitorEnabled", description: "childWatchingMonitorEnabledHint" },
  { view: "profiles", label: "childLock", description: "childLockHint" },
  { view: "profiles", label: "profilePermissionsTitle", description: "profilePermissionsHint" },
  { view: "auth", label: "authTab" },
  { view: "advanced", label: "automaticUpdateChecks", description: "automaticUpdateChecksHint" },
  { view: "advanced:dangerous", label: "backupRestore", description: "backupRestoreHint" },
];

export function staticSettingsSearchEntries(t: Translate, sectionLabels: Map<string, string>): SettingsSearchEntry[] {
  return CATALOG.filter((entry) => sectionLabels.has(entry.view)).map((entry) => ({
    id: `setting:${entry.view}:${entry.label}`,
    view: entry.view,
    label: t(entry.label),
    description: entry.description ? t(entry.description) : undefined,
    section: sectionLabels.get(entry.view) ?? "",
  }));
}

export function normalizeSettingsSearch(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim();
}

export function filterSettingsSearchEntries(entries: SettingsSearchEntry[], query: string, limit = 8): SettingsSearchEntry[] {
  const needle = normalizeSettingsSearch(query);
  if (!needle) return [];
  return entries
    .map((entry) => {
      const label = normalizeSettingsSearch(entry.label);
      const description = normalizeSettingsSearch(entry.description ?? "");
      const section = normalizeSettingsSearch(entry.section);
      const score = label.startsWith(needle) ? 0 : label.includes(needle) ? 1 : description.includes(needle) ? 2 : section.includes(needle) ? 3 : -1;
      return { entry, score };
    })
    .filter((result) => result.score >= 0)
    .sort((left, right) => left.score - right.score || left.entry.label.localeCompare(right.entry.label))
    .slice(0, limit)
    .map((result) => result.entry);
}
