import { readFile } from "node:fs/promises";

const lineLimits: Record<string, number> = {
  "app/src/routes.ts": 464,
  "app/src/routes/authRoutes.ts": 456,
  "app/src/routes/backupRoutes.ts": 143,
  "app/src/routes/channelPlaylistRoutes.ts": 174,
  "app/src/routes/channelRoutes.ts": 631,
  "app/src/routes/childRoutes.ts": 157,
  "app/src/routes/downloadRoutes.ts": 404,
  "app/src/routes/feedRoutes.ts": 154,
  "app/src/routes/historyRoutes.ts": 61,
  "app/src/routes/importRoutes.ts": 245,
  "app/src/routes/insightRoutes.ts": 65,
  "app/src/routes/libraryRoutes.ts": 114,
  "app/src/routes/pluginRoutes.ts": 86,
  "app/src/routes/profileRoutes.ts": 430,
  "app/src/routes/settingsRoutes.ts": 151,
  "app/src/routes/socialRoutes.ts": 187,
  "app/src/routes/systemRoutes.ts": 137,
  "app/src/routes/tagRoutes.ts": 148,
  "app/src/routes/userPlaylistRoutes.ts": 188,
  "app/src/routes/videoActionRoutes.ts": 184,
  "app/src/routes/videoRoutes.ts": 502,
  "app/src/videoRoutesSupport.ts": 133,
  "app/src/routeCache.ts": 11,
  "ui/src/pages/SettingsPage.tsx": 1340,
  "ui/src/pages/useSettingsPageController.tsx": 1370,
  "ui/src/components/settings/SettingsDisplayView.tsx": 539,
  "ui/src/pages/WatchPage.tsx": 990,
  "ui/src/pages/useWatchPageController.tsx": 1502,
  "ui/src/pages/WatchPage.css": 1431,
  "app/src/plugins.ts": 1065,
  "app/src/pluginCatalog.ts": 404,
  "ui/src/api.ts": 508,
  "ui/src/apiTypes.ts": 991,
  "app/src/refresher.ts": 1331,
  "app/src/refreshScheduler.ts": 104,
  "app/src/downloader.ts": 1036,
  "app/src/downloadConfig.ts": 169,
  "app/src/downloadStreaming.ts": 299,
  "app/src/youtube.ts": 1187,
  "app/src/youtubeSearch.ts": 196,
  "ui/src/i18n/locales/pl.ts": 1278,
  "ui/src/i18n/locales/de.ts": 1276,
  "ui/src/i18n/locales/en.ts": 1208,
  "app/src/db.ts": 605,
  "app/src/schema.sql": 522,
  "app/src/portableBackup.ts": 432,
  "app/src/portableArchive.ts": 76,
  "ui/src/pages/SettingsPage.css": 1074,
};

const failures: string[] = [];
for (const [path, maximum] of Object.entries(lineLimits)) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const lines = source.endsWith("\n") ? source.split("\n").length - 1 : source.split("\n").length;
  if (lines > maximum) failures.push(`${path} grew to ${lines} lines (ratchet: ${maximum})`);
}

if (failures.length) {
  console.error("Large-file ratchet failed:\n" + failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}
