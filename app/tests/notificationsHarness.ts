const { notifyChannelVideos, notifyDownloadFailed, notifyTagRuleMatches } = await import("../src/notifications");
const { applyAutoTags } = await import("../src/autotags");
const { db, setSetting } = await import("../src/db");

db.prepare("INSERT INTO channels(channel_id, title, url) VALUES(?, ?, ?)")
  .run("UCnotify", "Notification channel", "https://youtube.com/channel/UCnotify");
db.prepare("INSERT INTO videos(video_id, channel_id, title, thumbnail) VALUES(?, ?, ?, ?)")
  .run("notifyvideo1", "UCnotify", "Failed video", "https://example.com/thumb.jpg");
db.prepare("INSERT INTO downloads(video_id, status, error, attempts, created_at) VALUES(?, 'error', ?, 1, ?)")
  .run("notifyvideo1", "network failure", "2026-07-28 20:00:00");
db.prepare("INSERT INTO download_owners(user_id, video_id, source) VALUES(1, ?, 'manual')").run("notifyvideo1");
db.prepare("INSERT INTO users(name, avatar_color, sort_order, portable_uuid, is_child) VALUES(?, ?, ?, ?, 1)")
  .run("Child", "#123456", 1, crypto.randomUUID());

const firstCreated = await notifyDownloadFailed("notifyvideo1", "network failure");
const duplicateCreated = await notifyDownloadFailed("notifyvideo1", "network failure");
const firstRows = db.prepare("SELECT user_id, kind, target, payload FROM notifications ORDER BY id").all();

db.prepare("UPDATE downloads SET created_at = ? WHERE video_id = ?")
  .run("2026-07-28 21:00:00", "notifyvideo1");
const nextCycleCreated = await notifyDownloadFailed("notifyvideo1", "another failure");
const finalCount = (db.prepare("SELECT count(*) AS count FROM notifications").get() as { count: number }).count;

db.prepare("INSERT INTO user_channels(user_id,channel_id,followed) VALUES(1,'UCnotify',1)").run();
const channelDefaultCreated = await notifyChannelVideos("UCnotify", ["notifyvideo1"]);
db.prepare("INSERT INTO notification_preferences(user_id,kind,source_id,enabled) VALUES(1,'channel_video','UCnotify',1)").run();
const channelOverrideCreated = await notifyChannelVideos("UCnotify", ["notifyvideo1"]);
db.prepare("UPDATE downloads SET created_at='2026-07-28 22:00:00' WHERE video_id='notifyvideo1'").run();
db.prepare("INSERT INTO notification_preferences(user_id,kind,source_id,enabled) VALUES(1,'*','',0)").run();
const masterDisabledCreated = await notifyDownloadFailed("notifyvideo1", "disabled");

// ---------- auto-tag rule notifications ----------
db.prepare("DELETE FROM notification_preferences WHERE user_id=1 AND kind='*'").run();
db.prepare("INSERT INTO tags(name,color,user_id,portable_uuid) VALUES(?,?,1,?)").run("Rust", "#dea584", crypto.randomUUID());
const tagId = (db.prepare("SELECT id FROM tags WHERE name='Rust'").get() as { id: number }).id;
db.prepare("INSERT INTO auto_tag_rules(tag_id,pattern,match_type,field,user_id) VALUES(?,?,'contains','title',1)").run(tagId, "rust");
// A rule left over from the single-user era has no owner and must only tag.
db.prepare("INSERT INTO auto_tag_rules(tag_id,pattern,match_type,field,user_id) VALUES(?,?,'contains','title',NULL)").run(tagId, "rust");
const ruleId = (db.prepare("SELECT id FROM auto_tag_rules WHERE user_id=1").get() as { id: number }).id;
db.prepare("INSERT INTO videos(video_id, channel_id, title, thumbnail) VALUES(?, ?, ?, ?)")
  .run("rustvideo1", "UCnotify", "Rust in 2026", "https://example.com/rust.jpg");

const ruleMatches = await applyAutoTags("rustvideo1", "Rust in 2026", "");
const taggedVideo = db.prepare("SELECT count(*) AS count FROM video_tags WHERE video_id='rustvideo1' AND source='auto'").get() as { count: number };
const tagRuleDefaultCreated = await notifyTagRuleMatches("rustvideo1", ruleMatches);
db.prepare("INSERT INTO notification_preferences(user_id,kind,source_id,enabled) VALUES(1,'tag_rule','',1)").run();
const tagRuleCategoryCreated = await notifyTagRuleMatches("rustvideo1", ruleMatches);
const tagRuleDuplicateCreated = await notifyTagRuleMatches("rustvideo1", ruleMatches);
const tagRuleRows = db.prepare("SELECT user_id, kind, target, payload FROM notifications WHERE kind='tag_rule'").all();

db.prepare("INSERT INTO videos(video_id, channel_id, title, thumbnail) VALUES(?, ?, ?, ?)")
  .run("rustvideo2", "UCnotify", "More Rust", "https://example.com/rust2.jpg");
db.prepare("INSERT INTO notification_preferences(user_id,kind,source_id,enabled) VALUES(1,'tag_rule',?,0)").run(String(ruleId));
const tagRuleSourceOffCreated = await notifyTagRuleMatches("rustvideo2", await applyAutoTags("rustvideo2", "More Rust", ""));

// ---------- external provider fan-out ----------
const plugins = await import("../src/plugins");
const delivery = await import("../src/notificationDelivery");
await plugins.setPluginEnabled("notifications", true);
await plugins.setPluginSettings(1, "notifications", { provider: "apprise" });
await setSetting("plugin_notifications_apprise_server_url", "http://apprise.local:8000");
await setSetting("plugin_notifications_public_base_url", "https://ytzero.example");
db.prepare("INSERT INTO notification_delivery(user_id,provider,enabled,targets) VALUES(1,'apprise',1,?)").run("tgram://token/chat\ndiscord://id/token");

const adminDeliverySnapshot = await delivery.notificationDeliverySnapshot(1, true);
const profileDeliverySnapshot = await delivery.notificationDeliverySnapshot(1, false);
let unauthorizedProviderError = "";
try { await delivery.setNotificationDelivery(1, { appriseServerUrl: "https://forbidden.example" }, false); }
catch (error) { unauthorizedProviderError = error instanceof Error ? error.message : String(error); }

let deliveredRequest: { url: string; body: any } | null = null;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  deliveredRequest = { url: String(input), body: JSON.parse(String(init?.body ?? "{}")) };
  return new Response("ok", { status: 200 });
}) as typeof fetch;
const delivered = await delivery.deliverNotification(1, "tag_rule", {
  videoTitle: "Rust in 2026",
  channelTitle: "Notification channel",
  tagName: "Rust",
  rulePattern: "rust",
}, "/watch/rustvideo1");
await plugins.resetPluginState(1, "notifications");
const resetDeliverySnapshot = await delivery.notificationDeliverySnapshot(1, true);
const resetDeliveryRows = db.prepare("SELECT provider,enabled,targets FROM notification_delivery WHERE user_id=1").all();

console.log("RESULT " + JSON.stringify({ firstCreated, duplicateCreated, firstRows, nextCycleCreated, finalCount, channelDefaultCreated, channelOverrideCreated, masterDisabledCreated, ruleMatches, taggedVideo, tagRuleDefaultCreated, tagRuleCategoryCreated, tagRuleDuplicateCreated, tagRuleRows, tagRuleSourceOffCreated, adminDeliverySnapshot, profileDeliverySnapshot, unauthorizedProviderError, delivered, deliveredRequest, resetDeliverySnapshot, resetDeliveryRows }));
db.close();
