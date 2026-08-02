const { api } = await import("../src/routes");
const { db } = await import("../src/db");

async function json(path: string) {
  const response = await api.request(`http://localhost${path}`, {
    headers: { Cookie: "ytzero_profile=1" },
  });
  return { status: response.status, body: await response.json() as any };
}

const plugins = await json("/plugins");
const pluginId = plugins.body.plugins?.[0]?.id;
const pluginSettings = pluginId ? await json(`/plugins/${pluginId}/settings`) : null;
const channels = await json("/channels");
const recentChannels = await json("/channels/recent");
const downloads = await json("/downloads");
const updateDownloadSettingsResponse = await api.request("http://localhost/downloads/config", {
  method: "PUT",
  headers: { Cookie: "ytzero_profile=1", "Content-Type": "application/json" },
  body: JSON.stringify({ settings: { max_storage_gb: 17 } }),
});
const updatedDownloadSettings = await updateDownloadSettingsResponse.json() as any;
const reloadedDownloadSettings = await json("/downloads/config");
const legacyDownloadPluginRoute = await json("/plugins/downloads/settings");
const updateSettingsResponse = await api.request("http://localhost/settings", {
  method: "PUT",
  headers: { Cookie: "ytzero_profile=1", "Content-Type": "application/json" },
  body: JSON.stringify({ show_shorts: "0", feed_sort: "arrival", app_icon_color: "#123456" }),
});
const reloadedSettings = await json("/settings");

console.log("RESULT " + JSON.stringify({
  pluginsStatus: plugins.status,
  pluginsIsArray: Array.isArray(plugins.body.plugins),
  pluginSettingsStatus: pluginSettings?.status ?? null,
  pluginSettingsIsObject: pluginSettings?.body != null && typeof pluginSettings.body === "object" && !Array.isArray(pluginSettings.body),
  channelsStatus: channels.status,
  channelsIsArray: Array.isArray(channels.body.channels),
  instanceHasDataIsBoolean: typeof channels.body.instance_has_data === "boolean",
  recentChannelsStatus: recentChannels.status,
  recentChannelsIsArray: Array.isArray(recentChannels.body.channels),
  downloadsStatus: downloads.status,
  downloadsIsArray: Array.isArray(downloads.body.downloads),
  downloadStatsIsObject: downloads.body.stats != null && typeof downloads.body.stats === "object" && !Array.isArray(downloads.body.stats),
  updateDownloadSettingsStatus: updateDownloadSettingsResponse.status,
  updatedDownloadSetting: updatedDownloadSettings.settings?.max_storage_gb,
  reloadedDownloadSetting: reloadedDownloadSettings.body.settings?.max_storage_gb,
  legacyDownloadPluginRouteStatus: legacyDownloadPluginRoute.status,
  updateSettingsStatus: updateSettingsResponse.status,
  reloadedUserSetting: reloadedSettings.body.settings?.show_shorts,
  reloadedFeedSort: reloadedSettings.body.settings?.feed_sort,
  reloadedGlobalSetting: reloadedSettings.body.settings?.app_icon_color,
}));

db.close();
