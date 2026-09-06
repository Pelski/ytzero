const { api } = await import("../src/routes");
const { db } = await import("../src/db");
const { cleanupDownloadsNow } = await import("../src/downloader");
const { applyPlaylistRulesToVideo } = await import("../src/userPlaylists");
const { join } = await import("node:path");

const secondary = db.prepare("INSERT INTO users(name,avatar_color,sort_order,portable_uuid) VALUES(?,?,?,?) RETURNING id")
  .get("Secondary", "#224466", 1, crypto.randomUUID()) as { id: number };
db.prepare("INSERT INTO channels(channel_id,title,url) VALUES('UC-dl-scope','Scoped channel','')").run();
for (const id of ["scope-primary", "scope-secondary", "scope-shared", "keep-request"]) {
  db.prepare("INSERT INTO videos(video_id,channel_id,title,thumbnail) VALUES(?,'UC-dl-scope',?,'')").run(id, id);
  if (id === "keep-request") continue;
  db.prepare("INSERT INTO downloads(video_id,status,source,requested_by_user_id) VALUES(?,'done','manual',?)").run(id, id === "scope-secondary" ? secondary.id : 1);
}
db.prepare("INSERT INTO download_owners(user_id,video_id,source) VALUES(1,'scope-primary','manual')").run();
db.prepare("INSERT INTO download_owners(user_id,video_id,source) VALUES(?,'scope-secondary','manual')").run(secondary.id);
db.prepare("INSERT INTO download_owners(user_id,video_id,source) VALUES(1,'scope-shared','manual')").run();
db.prepare("INSERT INTO download_owners(user_id,video_id,source) VALUES(?,'scope-shared','manual')").run(secondary.id);

const request = (profileId: number, path: string, init?: RequestInit) => api.request(`http://localhost${path}`, {
  ...init,
  headers: { Cookie: `ytzero_profile=${profileId}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
});
const body = async (profileId: number, path: string, init?: RequestInit) => {
  const response = await request(profileId, path, init);
  return { status: response.status, value: await response.json() as any };
};

const primaryMine = await body(1, "/downloads");
const secondaryMine = await body(secondary.id, "/downloads");
const primaryAll = await body(1, "/downloads?scope=all");
const secondaryAllAttempt = await body(secondary.id, "/downloads?scope=all");
await body(1, "/downloads/config", { method: "PUT", body: JSON.stringify({ enabled: true }) });
await body(1, "/videos/keep-request/download", { method: "POST", body: JSON.stringify({ keep: true }) });
const keepRequestOwner = db.prepare("SELECT pinned FROM download_owners WHERE user_id=1 AND video_id='keep-request'").get();

const ruleInput = {
  name: "Secondary rule", enabled: true, source_mode: "selected", channel_ids: ["UC-dl-scope"], playlist_ids: [],
  include_keywords: [], exclude_keywords: [], keyword_mode: "any", match_field: "title", include_shorts: false,
  include_members_only: false, min_duration_seconds: 0, backfill_mode: "future", lookback_hours: 48,
};
await body(secondary.id, "/downloads/automation", { method: "POST", body: JSON.stringify(ruleInput) });
const primaryRules = await body(1, "/downloads/automation");
const secondaryRules = await body(secondary.id, "/downloads/automation");

const secondaryQuality = await body(secondary.id, "/downloads/config", { method: "PUT", body: JSON.stringify({ settings: { quality: "720", compatible_format: 1, retention_days: 30 } }) });
const primaryConfig = await body(1, "/downloads/config");
const secondaryAdminSetting = await body(secondary.id, "/downloads/config", { method: "PUT", body: JSON.stringify({ settings: { output_template: "private/{id}" } }) });

const cookieForm = new FormData();
cookieForm.set("file", new File(["# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tsecondary"], "cookies.txt", { type: "text/plain" }));
await api.request("http://localhost/downloads/cookies", {
  method: "POST",
  headers: { Cookie: `ytzero_profile=${secondary.id}` },
  body: cookieForm,
});
const secondaryCookies = await body(secondary.id, "/downloads/cookies");
const primaryCookies = await body(1, "/downloads/cookies");

await body(secondary.id, "/videos/scope-shared/download", { method: "DELETE" });
const sharedOwnersAfterDelete = db.prepare("SELECT user_id FROM download_owners WHERE video_id='scope-shared' ORDER BY user_id").all();
const sharedPhysicalAfterDelete = db.prepare("SELECT status FROM downloads WHERE video_id='scope-shared'").get();

db.prepare("INSERT INTO videos(video_id,channel_id,title,thumbnail) VALUES('scope-retention','UC-dl-scope','scope-retention','')").run();
const retentionPath = join(Bun.env.DOWNLOADS_DIR!, "scope-retention.mp4");
await Bun.write(retentionPath, "retained");
db.prepare("INSERT INTO downloads(video_id,status,source,path,size_bytes,finished_at,requested_by_user_id) VALUES('scope-retention','done','manual',?,8,datetime('now','-31 days'),1)").run(retentionPath);
db.prepare("INSERT INTO download_owners(user_id,video_id,source) VALUES(1,'scope-retention','manual')").run();
db.prepare("INSERT INTO download_owners(user_id,video_id,source) VALUES(?,'scope-retention','manual')").run(secondary.id);
db.prepare("INSERT INTO download_settings(user_id,key,value) VALUES(1,'keep_downloads','1') ON CONFLICT(user_id,key) DO UPDATE SET value='1'").run();
db.prepare("INSERT INTO download_settings(user_id,key,value) VALUES(?,'retention_days','14') ON CONFLICT(user_id,key) DO UPDATE SET value='14'").run(secondary.id);
await cleanupDownloadsNow();
const retentionOwners = db.prepare("SELECT user_id FROM download_owners WHERE video_id='scope-retention' ORDER BY user_id").all();
const retentionPhysical = db.prepare("SELECT status FROM downloads WHERE video_id='scope-retention'").get();

db.prepare("INSERT INTO videos(video_id,channel_id,title,thumbnail) VALUES('scope-watched','UC-dl-scope','scope-watched','')").run();
const watchedPath = join(Bun.env.DOWNLOADS_DIR!, "scope-watched.mp4");
await Bun.write(watchedPath, "watched");
db.prepare("INSERT INTO downloads(video_id,status,source,path,size_bytes,finished_at,requested_by_user_id) VALUES('scope-watched','done','manual',?,7,datetime('now','-31 days'),1)").run(watchedPath);
db.prepare("INSERT INTO download_owners(user_id,video_id,source) VALUES(1,'scope-watched','manual')").run();
db.prepare("INSERT INTO user_videos(user_id,video_id,status,watched) VALUES(1,'scope-watched','archived',1)").run();
db.prepare("INSERT INTO history(user_id,video_id,watched_at) VALUES(1,'scope-watched',datetime('now','-2 days'))").run();
await cleanupDownloadsNow();
const watchedWhileKept = db.prepare("SELECT status FROM downloads WHERE video_id='scope-watched'").get();

db.prepare("UPDATE download_settings SET value='0' WHERE user_id=1 AND key='keep_downloads'").run();
await cleanupDownloadsNow();
const watchedAfterKeepDisabled = db.prepare("SELECT status FROM downloads WHERE video_id='scope-watched'").get();

for (const id of ["cap-kept", "cap-pinned", "cap-liked"]) {
  db.prepare("INSERT INTO videos(video_id,channel_id,title,thumbnail) VALUES(?,'UC-dl-scope',?,'')").run(id, id);
  const path = join(Bun.env.DOWNLOADS_DIR!, `${id}.mp4`);
  await Bun.write(path, id);
  db.prepare("INSERT INTO downloads(video_id,status,source,path,size_bytes,finished_at,requested_by_user_id) VALUES(?,'done','manual',?,?,datetime('now'),1)")
    .run(id, path, id === "cap-kept" ? 2 * 1024 ** 3 : 1);
  db.prepare("INSERT INTO download_owners(user_id,video_id,source,pinned) VALUES(1,?,'manual',?)").run(id, id === "cap-pinned" ? 1 : 0);
}
db.prepare("INSERT INTO user_videos(user_id,video_id,liked) VALUES(1,'cap-liked',1)").run();
db.prepare("INSERT INTO download_settings(user_id,key,value) VALUES(1,'keep_downloads','1') ON CONFLICT(user_id,key) DO UPDATE SET value='1'").run();
await body(1, "/downloads/config", { method: "PUT", body: JSON.stringify({ settings: { max_storage_gb: 1 } }) });
await cleanupDownloadsNow();
const storageCap = db.prepare("SELECT video_id,status FROM downloads WHERE video_id IN ('cap-kept','cap-pinned','cap-liked') ORDER BY video_id").all();

db.prepare("INSERT INTO videos(video_id,channel_id,title,thumbnail) VALUES('playlist-kept','UC-dl-scope','playlist-kept','')").run();
const playlistKeptPath = join(Bun.env.DOWNLOADS_DIR!, "playlist-kept.mp4");
await Bun.write(playlistKeptPath, "playlist-kept");
db.prepare("INSERT INTO downloads(video_id,status,source,path,size_bytes,finished_at,requested_by_user_id) VALUES('playlist-kept','done','manual',?,13,datetime('now','-31 days'),1)").run(playlistKeptPath);
db.prepare("INSERT INTO download_owners(user_id,video_id,source) VALUES(1,'playlist-kept','manual')").run();
const offlinePlaylist = db.prepare("INSERT INTO user_playlists(name,user_id,portable_uuid) VALUES('Repairs',1,?) RETURNING id").get(crypto.randomUUID()) as { id: number };
db.prepare("INSERT INTO user_playlist_videos(playlist_id,video_id) VALUES(?,'playlist-kept')").run(offlinePlaylist.id);
db.prepare("INSERT INTO download_settings(user_id,key,value) VALUES(1,'keep_downloads','0') ON CONFLICT(user_id,key) DO UPDATE SET value='0'").run();
db.prepare("INSERT INTO download_settings(user_id,key,value) VALUES(1,'retention_days','1') ON CONFLICT(user_id,key) DO UPDATE SET value='1'").run();
await body(1, `/playlists/${offlinePlaylist.id}`, { method: "PUT", body: JSON.stringify({ offline_policy: "keep" }) });
await cleanupDownloadsNow();
const playlistProtected = db.prepare("SELECT status FROM downloads WHERE video_id='playlist-kept'").get();
const playlistLibrary = await body(1, "/downloads");
await body(1, `/playlists/${offlinePlaylist.id}`, { method: "PUT", body: JSON.stringify({ offline_policy: "none" }) });
await cleanupDownloadsNow();
const playlistUnprotected = db.prepare("SELECT status FROM downloads WHERE video_id='playlist-kept'").get();

db.prepare("INSERT INTO videos(video_id,channel_id,title,thumbnail) VALUES('followed-playlist-kept','UC-dl-scope','followed-playlist-kept',''),('followed-quality-queue','UC-dl-scope','followed-quality-queue','')").run();
db.prepare("INSERT INTO channel_playlists(playlist_id,channel_id,title,thumbnail) VALUES('PL-followed-offline','UC-dl-scope','Followed repairs','')").run();
db.prepare("INSERT INTO channel_playlist_videos(playlist_id,video_id) VALUES('PL-followed-offline','followed-playlist-kept'),('PL-followed-offline','followed-quality-queue')").run();
db.prepare("INSERT INTO user_followed_playlists(user_id,playlist_id) VALUES(1,'PL-followed-offline')").run();
const followedPlaylistPath = join(Bun.env.DOWNLOADS_DIR!, "followed-playlist-kept.mp4");
await Bun.write(followedPlaylistPath, "followed-playlist-kept");
db.prepare("INSERT INTO downloads(video_id,status,source,path,size_bytes,finished_at,requested_by_user_id) VALUES('followed-playlist-kept','done','manual',?,13,datetime('now','-31 days'),1)").run(followedPlaylistPath);
db.prepare("INSERT INTO download_owners(user_id,video_id,source) VALUES(1,'followed-playlist-kept','manual')").run();
await body(1, "/channel-playlists/PL-followed-offline/offline-policy", { method: "PUT", body: JSON.stringify({ offline_policy: "keep", download_quality: "1080" }) });
const followedPlaylistRequestedQuality = db.prepare("SELECT requested_quality FROM downloads WHERE video_id='followed-quality-queue'").get();
await cleanupDownloadsNow();
const followedPlaylistProtected = db.prepare("SELECT status FROM downloads WHERE video_id='followed-playlist-kept'").get();
const followedPlaylistLibrary = await body(1, "/downloads");
await body(1, "/channel-playlists/PL-followed-offline/offline-policy", { method: "PUT", body: JSON.stringify({ offline_policy: "none" }) });
await cleanupDownloadsNow();
const followedPlaylistUnprotected = db.prepare("SELECT status FROM downloads WHERE video_id='followed-playlist-kept'").get();

db.prepare("INSERT INTO videos(video_id,channel_id,title,thumbnail) VALUES('playlist-rule-future','UC-dl-scope','Future repair guide','')").run();
const rulePlaylistUuid = crypto.randomUUID();
const rulePlaylist = db.prepare("INSERT INTO user_playlists(name,user_id,portable_uuid,offline_policy,download_quality) VALUES('Automatic repairs',1,?,'keep','720') RETURNING id").get(rulePlaylistUuid) as { id: number };
db.prepare("INSERT INTO user_playlist_rules(playlist_id,pattern,match_type,field) VALUES(?,'repair','contains','title')").run(rulePlaylist.id);
await applyPlaylistRulesToVideo("playlist-rule-future");
const playlistQualityUpdate = await body(1, `/playlists/${rulePlaylist.id}`, { method: "PUT", body: JSON.stringify({ download_quality: "480" }) });
const invalidPlaylistQuality = await body(1, `/playlists/${rulePlaylist.id}`, { method: "PUT", body: JSON.stringify({ download_quality: "2160" }) });
db.prepare("INSERT INTO videos(video_id,channel_id,title,thumbnail) VALUES('playlist-prefetch','UC-dl-scope','playlist-prefetch','')").run();
db.prepare("INSERT INTO user_playlist_videos(playlist_id,video_id) VALUES(?,'playlist-prefetch')").run(rulePlaylist.id);
await body(1, "/videos/playlist-prefetch/download", { method: "POST", body: JSON.stringify({ playlist_context: { kind: "user-playlist", playlistUuid: rulePlaylistUuid } }) });
const playlistPrefetchRequestedQuality = db.prepare("SELECT requested_quality FROM downloads WHERE video_id='playlist-prefetch'").get();
const ruleOfflineResult = {
  membership: db.prepare("SELECT 1 AS present FROM user_playlist_videos WHERE playlist_id=? AND video_id='playlist-rule-future'").get(rulePlaylist.id),
  owner: db.prepare("SELECT 1 AS present FROM download_owners WHERE user_id=1 AND video_id='playlist-rule-future'").get(),
  protection: db.prepare("SELECT 1 AS present FROM user_playlist_download_protections WHERE playlist_id=? AND video_id='playlist-rule-future'").get(rulePlaylist.id),
  requestedQuality: db.prepare("SELECT requested_quality FROM downloads WHERE video_id='playlist-rule-future'").get(),
};

console.log("RESULT " + JSON.stringify({
  secondaryId: secondary.id,
  primaryMine: primaryMine.value.downloads.map((item: any) => `${item.user_id}:${item.video_id}`).sort(),
  secondaryMine: secondaryMine.value.downloads.map((item: any) => `${item.user_id}:${item.video_id}`).sort(),
  primaryAll: primaryAll.value.downloads.map((item: any) => `${item.user_id}:${item.video_id}`).sort(),
  secondaryAllScope: secondaryAllAttempt.value.scope,
  keepRequestOwner,
  primaryRuleCount: primaryRules.value.rules.length,
  secondaryRuleCount: secondaryRules.value.rules.length,
  secondaryQualityStatus: secondaryQuality.status,
  secondaryQuality: secondaryQuality.value.settings?.quality,
  secondaryCompatibleFormat: secondaryQuality.value.settings?.compatible_format,
  primaryCompatibleFormat: primaryConfig.value.settings?.compatible_format,
  secondaryRetention: secondaryQuality.value.settings?.retention_days,
  primaryRetention: primaryConfig.value.settings?.retention_days,
  secondaryAdminSettingStatus: secondaryAdminSetting.status,
  secondaryCookies: secondaryCookies.value.configured,
  primaryCookies: primaryCookies.value.configured,
  sharedOwnersAfterDelete,
  sharedPhysicalAfterDelete,
  retentionOwners,
  retentionPhysical,
  watchedWhileKept,
  watchedAfterKeepDisabled,
  storageCap,
  playlistProtected,
  playlistUnprotected,
  playlistLibraryItem: playlistLibrary.value.downloads.find((item: any) => item.video_id === "playlist-kept"),
  followedPlaylistProtected,
  followedPlaylistUnprotected,
  followedPlaylistLibraryItem: followedPlaylistLibrary.value.downloads.find((item: any) => item.video_id === "followed-playlist-kept"),
  followedPlaylistRequestedQuality,
  playlistQualityUpdate: { status: playlistQualityUpdate.status, value: playlistQualityUpdate.value.playlist?.download_quality },
  invalidPlaylistQualityStatus: invalidPlaylistQuality.status,
  playlistPrefetchRequestedQuality,
  ruleOfflineResult,
}));
db.close();
