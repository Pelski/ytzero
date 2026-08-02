const { db, setSetting } = await import("../src/db");
const { automaticDownloadCandidates, createDownloadRule, listDownloadRules, migrateLegacyDownloadAutomation, previewDownloadRule, updateDownloadRule } = await import("../src/downloadRules");

db.prepare("INSERT INTO channels(channel_id,title,url) VALUES(?,?,?)").run("UC-rule", "Rule Channel", "");
db.prepare("INSERT INTO channels(channel_id,title,url) VALUES(?,?,?)").run("UC-other", "Other Channel", "");
const insertVideo = db.prepare("INSERT INTO videos(video_id,channel_id,title,description,thumbnail,published_at,created_at,is_short,members_only) VALUES(?,?,?,?,?,datetime('now'),datetime('now','-1 day'),?,?)");
insertVideo.run("rule-main", "UC-rule", "Gameplay episode", "clean", "", 0, 0);
insertVideo.run("rule-trailer", "UC-rule", "Gameplay trailer", "clean", "", 0, 0);
insertVideo.run("rule-short", "UC-rule", "Gameplay short", "clean", "", 1, 0);
insertVideo.run("rule-members", "UC-rule", "Gameplay bonus", "clean", "", 0, 1);
insertVideo.run("rule-other", "UC-other", "Gameplay episode", "clean", "", 0, 0);
insertVideo.run("rule-watched", "UC-rule", "Gameplay watched", "clean", "", 0, 0);
insertVideo.run("rule-archived", "UC-rule", "Gameplay archived", "clean", "", 0, 0);
insertVideo.run("rule-imported", "UC-rule", "Gameplay imported", "clean", "", 0, 0);
db.prepare("UPDATE videos SET external=1 WHERE video_id='rule-imported'").run();
db.prepare("INSERT INTO user_videos(user_id,video_id,status,watched) VALUES(1,'rule-watched','inbox',1)").run();
db.prepare("INSERT INTO user_videos(user_id,video_id,status) VALUES(1,'rule-archived','archived')").run();
db.prepare("INSERT INTO user_channels(user_id,channel_id,followed) VALUES(1,'UC-rule',1)").run();
db.prepare("INSERT INTO user_channels(user_id,channel_id,followed) VALUES(1,'UC-other',1)").run();

const input = {
  name: "Gameplay, no trailers",
  enabled: true,
  source_mode: "selected" as const,
  channel_ids: ["UC-rule"],
  playlist_ids: [],
  include_keywords: ["gameplay"],
  exclude_keywords: ["trailer"],
  keyword_mode: "any" as const,
  match_field: "title" as const,
  include_shorts: false,
  include_members_only: false,
  min_duration_seconds: 0,
  backfill_mode: "all" as const,
  lookback_hours: 48,
};

const preview = await previewDownloadRule(1, input);
const created = await createDownloadRule(1, input);
const candidates = await automaticDownloadCandidates();
const updated = await updateDownloadRule(1, created.id, { include_members_only: true });
const updatedPreview = await previewDownloadRule(1, updated!);
await updateDownloadRule(1, created.id, { include_shorts: true });
const candidatesWithoutShorts = await automaticDownloadCandidates();
db.prepare("INSERT OR IGNORE INTO plugins(id,enabled,version) VALUES('downloads',0,'test')").run();
db.prepare("INSERT INTO plugin_settings(plugin_id,user_id,key,value) VALUES('downloads',1,'download_shorts','1')").run();
const candidatesWithShorts = await automaticDownloadCandidates();
const rules = await listDownloadRules(1);
let invalidRuleError = "";
try { await createDownloadRule(1, { name: "Invalid", source_mode: "selected" }); }
catch (error) { invalidRuleError = error instanceof Error ? error.message : String(error); }
const subscriptionExceptions = await previewDownloadRule(1, { ...input, source_mode: "subscriptions", channel_ids: ["UC-rule"] });
db.prepare("DELETE FROM download_rules").run();
db.prepare("UPDATE channels SET auto_download_min_duration_override=300 WHERE channel_id='UC-rule'").run();
db.prepare("UPDATE channels SET auto_download_min_duration_override=0 WHERE channel_id='UC-other'").run();
setSetting("plugin_downloads_download_feed", "1");
setSetting("plugin_downloads_feed_max_age_hours", "72");
await migrateLegacyDownloadAutomation();
const legacyRules = await listDownloadRules(1);

console.log("RESULT " + JSON.stringify({ preview, created, candidates, candidatesWithoutShorts, candidatesWithShorts, updatedPreview, rules, invalidRuleError, subscriptionExceptions, legacyRules }));
db.close();
