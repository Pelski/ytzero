const { api } = await import("../src/routes");
const { db, setSetting } = await import("../src/db");

const disabledChannelId = "UC_disabled_sync_test";
const activeChannelId = "UC_background_sync_test";
const secondary = db.prepare("INSERT INTO users(name, avatar_color, sort_order, portable_uuid) VALUES(?, ?, ?, ?) RETURNING id")
  .get("Secondary", "#336699", 2, crypto.randomUUID()) as { id: number };
const secondaryChannelId = "UC_secondary_sync_test";
db.prepare("INSERT INTO channels(channel_id, title, url, manual_status) VALUES(?, ?, ?, 'paused')")
  .run(disabledChannelId, "Paused channel", `https://youtube.com/channel/${disabledChannelId}`);
db.prepare("INSERT INTO user_channels(user_id, channel_id, followed) VALUES(1, ?, 1)").run(disabledChannelId);
db.prepare("INSERT INTO channels(channel_id, title, url, manual_status) VALUES(?, ?, ?, 'active')")
  .run(activeChannelId, "Background channel", `https://youtube.com/channel/${activeChannelId}`);
db.prepare("INSERT INTO user_channels(user_id, channel_id, followed) VALUES(1, ?, 1)").run(activeChannelId);
db.prepare("INSERT INTO channels(channel_id, title, url, manual_status) VALUES(?, ?, ?, 'active')")
  .run(secondaryChannelId, "Secondary channel", `https://youtube.com/channel/${secondaryChannelId}`);
db.prepare("INSERT INTO user_channels(user_id, channel_id, followed) VALUES(?, ?, 1)").run(secondary.id, secondaryChannelId);
// Exercise cross-profile job isolation with a profile that is explicitly
// allowed to manage subscriptions. The repository default keeps that area
// admin-only, which would otherwise reject the request before the job guard.
await setSetting("profile_admin_only_areas", JSON.stringify({ version: 3, adminOnlyAreas: [] }));

async function json(path: string, userId = 1) {
  const response = await api.request(`http://localhost${path}`, {
    headers: { Cookie: `ytzero_profile=${userId}` },
  });
  return { status: response.status, body: await response.json() as any };
}

async function postJson(path: string, body: unknown, userId = 1) {
  const response = await api.request(`http://localhost${path}`, {
    method: "POST",
    headers: { Cookie: `ytzero_profile=${userId}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as any };
}

const plugins = await json("/plugins");
const pluginId = plugins.body.plugins?.[0]?.id;
const pluginSettings = pluginId ? await json(`/plugins/${pluginId}/settings`) : null;
const channels = await json("/channels");
const recentChannels = await json("/channels/recent");
const channelSyncStatus = await json("/channels/sync");
const emptyChannelSync = await postJson("/channels/sync", { channel_ids: [] });
const unavailableChannelSync = await postJson("/channels/sync", { channel_ids: ["UC_not_followed"] });
const disabledChannelSync = await postJson("/channels/sync", { channel_ids: [disabledChannelId] });
const downloads = await json("/downloads");
const updateDownloadSettingsResponse = await api.request("http://localhost/downloads/config", {
  method: "PUT",
  headers: { Cookie: "ytzero_profile=1", "Content-Type": "application/json" },
  body: JSON.stringify({ settings: { max_storage_gb: 17 } }),
});
const updatedDownloadSettings = await updateDownloadSettingsResponse.json() as any;
const reloadedDownloadSettings = await json("/downloads/config");
const ytdlpConfigResponse = await api.request("http://localhost/downloads/ytdlp/config", {
  method: "PUT",
  headers: { Cookie: "ytzero_profile=1", "Content-Type": "application/json" },
  body: JSON.stringify({ update_channel: "stable", update_interval_days: 7 }),
});
const updatedYtdlpConfig = await ytdlpConfigResponse.json() as any;
const forbiddenYtdlpConfigResponse = await api.request("http://localhost/downloads/ytdlp/config", {
  method: "PUT",
  headers: { Cookie: `ytzero_profile=${secondary.id}`, "Content-Type": "application/json" },
  body: JSON.stringify({ update_channel: "nightly", update_interval_days: 1 }),
});
const legacyDownloadPluginRoute = await json("/plugins/downloads/settings");
const updateSettingsResponse = await api.request("http://localhost/settings", {
  method: "PUT",
  headers: { Cookie: "ytzero_profile=1", "Content-Type": "application/json" },
  body: JSON.stringify({ show_shorts: "0", feed_sort: "arrival", video_card_actions: "on_demand", video_card_swipe_devices: '{"version":1,"devices":["desktop","tablet"]}', app_icon_color: "#123456" }),
});
const reloadedSettings = await json("/settings");
const invalidVideoCardActionsResponse = await api.request("http://localhost/settings", {
  method: "PUT",
  headers: { Cookie: "ytzero_profile=1", "Content-Type": "application/json" },
  body: JSON.stringify({ video_card_actions: "surprise" }),
});
const invalidVideoCardSwipeResponse = await api.request("http://localhost/settings", {
  method: "PUT",
  headers: { Cookie: "ytzero_profile=1", "Content-Type": "application/json" },
  body: JSON.stringify({ video_card_swipe_devices: '{"version":1,"devices":["phone"]}' }),
});
const originalFetch = globalThis.fetch;
const resolveRateLimitFetches: Array<(response: Response) => void> = [];
globalThis.fetch = (() => new Promise<Response>((resolve) => { resolveRateLimitFetches.push(resolve); })) as unknown as typeof fetch;
const acceptedChannelSync = await postJson("/channels/sync", { channel_ids: [activeChannelId] });
for (let attempt = 0; resolveRateLimitFetches.length < 1 && attempt < 100; attempt++) await Bun.sleep(1);
const secondaryActiveView = await json("/channels/sync", secondary.id);
const secondaryAccepted = await postJson("/channels/sync", { channel_ids: [secondaryChannelId] }, secondary.id);
for (let attempt = 0; resolveRateLimitFetches.length < 2 && attempt < 100; attempt++) await Bun.sleep(1);
for (const resolveFetch of resolveRateLimitFetches) resolveFetch(new Response("limited", { status: 429 }));
let haltedChannelSync = await json("/channels/sync");
for (let attempt = 0; haltedChannelSync.body.job?.status === "running" && attempt < 100; attempt++) {
  await Bun.sleep(10);
  haltedChannelSync = await json("/channels/sync");
}
const secondaryTerminalView = await json("/channels/sync", secondary.id);
globalThis.fetch = (async () => new Response("limited", { status: 429 })) as unknown as typeof fetch;
const acceptedSingleChannelSync = await postJson(`/channels/${activeChannelId}/sync`, {});
let haltedSingleChannelSync = await json("/channels/sync");
for (let attempt = 0; haltedSingleChannelSync.body.job?.status === "running" && attempt < 100; attempt++) {
  await Bun.sleep(10);
  haltedSingleChannelSync = await json("/channels/sync");
}
globalThis.fetch = originalFetch;

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
  channelSyncStatusCode: channelSyncStatus.status,
  channelSyncInitialJob: channelSyncStatus.body.job,
  channelSyncInitiallyBusy: channelSyncStatus.body.busy,
  emptyChannelSyncStatus: emptyChannelSync.status,
  unavailableChannelSyncStatus: unavailableChannelSync.status,
  disabledChannelSyncStatus: disabledChannelSync.status,
  acceptedChannelSyncStatus: acceptedChannelSync.status,
  acceptedChannelSyncInitialStatus: acceptedChannelSync.body.job?.status,
  haltedChannelSyncStatus: haltedChannelSync.body.job?.status,
  haltedChannelSyncSkipped: haltedChannelSync.body.job?.skipped,
  haltedChannelSyncFailed: haltedChannelSync.body.job?.failed,
  secondaryActiveJob: secondaryActiveView.body.job,
  secondaryActiveBusy: secondaryActiveView.body.busy,
  secondaryAcceptedStatus: secondaryAccepted.status,
  secondaryAcceptedJobStatus: secondaryAccepted.body.job?.status,
  secondaryTerminalJob: secondaryTerminalView.body.job,
  secondaryTerminalBusy: secondaryTerminalView.body.busy,
  acceptedSingleChannelSyncStatus: acceptedSingleChannelSync.status,
  haltedSingleChannelSyncStatus: haltedSingleChannelSync.body.job?.status,
  downloadsStatus: downloads.status,
  downloadsIsArray: Array.isArray(downloads.body.downloads),
  downloadStatsIsObject: downloads.body.stats != null && typeof downloads.body.stats === "object" && !Array.isArray(downloads.body.stats),
  updateDownloadSettingsStatus: updateDownloadSettingsResponse.status,
  updatedDownloadSetting: updatedDownloadSettings.settings?.max_storage_gb,
  reloadedDownloadSetting: reloadedDownloadSettings.body.settings?.max_storage_gb,
  ytdlpConfigStatus: ytdlpConfigResponse.status,
  ytdlpUpdateChannel: updatedYtdlpConfig.update_channel,
  ytdlpUpdateIntervalDays: updatedYtdlpConfig.update_interval_days,
  forbiddenYtdlpConfigStatus: forbiddenYtdlpConfigResponse.status,
  legacyDownloadPluginRouteStatus: legacyDownloadPluginRoute.status,
  updateSettingsStatus: updateSettingsResponse.status,
  reloadedUserSetting: reloadedSettings.body.settings?.show_shorts,
  reloadedFeedSort: reloadedSettings.body.settings?.feed_sort,
  reloadedVideoCardActions: reloadedSettings.body.settings?.video_card_actions,
  reloadedVideoCardSwipeDevices: reloadedSettings.body.settings?.video_card_swipe_devices,
  reloadedGlobalSetting: reloadedSettings.body.settings?.app_icon_color,
  invalidVideoCardActionsStatus: invalidVideoCardActionsResponse.status,
  invalidVideoCardSwipeStatus: invalidVideoCardSwipeResponse.status,
}));

db.close();
