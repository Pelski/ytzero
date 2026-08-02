const { api } = await import("../src/routes");
const { db } = await import("../src/db");
const { cleanupDownloadsNow } = await import("../src/downloader");
const { join } = await import("node:path");

const secondary = db.prepare("INSERT INTO users(name,avatar_color,sort_order,portable_uuid) VALUES(?,?,?,?) RETURNING id")
  .get("Secondary", "#224466", 1, crypto.randomUUID()) as { id: number };
db.prepare("INSERT INTO channels(channel_id,title,url) VALUES('UC-dl-scope','Scoped channel','')").run();
for (const id of ["scope-primary", "scope-secondary", "scope-shared"]) {
  db.prepare("INSERT INTO videos(video_id,channel_id,title,thumbnail) VALUES(?,'UC-dl-scope',?,'')").run(id, id);
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
db.prepare("INSERT INTO download_settings(user_id,key,value) VALUES(1,'retention_days','14') ON CONFLICT(user_id,key) DO UPDATE SET value='14'").run();
db.prepare("INSERT INTO download_settings(user_id,key,value) VALUES(?,'retention_days','60') ON CONFLICT(user_id,key) DO UPDATE SET value='60'").run(secondary.id);
await cleanupDownloadsNow();
const retentionOwners = db.prepare("SELECT user_id FROM download_owners WHERE video_id='scope-retention' ORDER BY user_id").all();
const retentionPhysical = db.prepare("SELECT status FROM downloads WHERE video_id='scope-retention'").get();

console.log("RESULT " + JSON.stringify({
  secondaryId: secondary.id,
  primaryMine: primaryMine.value.downloads.map((item: any) => `${item.user_id}:${item.video_id}`).sort(),
  secondaryMine: secondaryMine.value.downloads.map((item: any) => `${item.user_id}:${item.video_id}`).sort(),
  primaryAll: primaryAll.value.downloads.map((item: any) => `${item.user_id}:${item.video_id}`).sort(),
  secondaryAllScope: secondaryAllAttempt.value.scope,
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
}));
db.close();
