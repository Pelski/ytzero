const { api } = await import("../src/routes");
const { db, setUserSetting } = await import("../src/db");
const { zonedDayHour } = await import("../src/timeZone");

const primaryId = 1;
const secondary = db.prepare(
  "INSERT INTO users(name, avatar_color, sort_order, portable_uuid) VALUES(?, ?, ?, ?) RETURNING id",
).get("Secondary", "#123456", 1, crypto.randomUUID()) as { id: number };
const child = db.prepare(
  "INSERT INTO users(name, avatar_color, sort_order, portable_uuid, is_child) VALUES(?, ?, ?, ?, 1) RETURNING id",
).get("Child", "#654321", 2, crypto.randomUUID()) as { id: number };
const downloadsChild = db.prepare(
  "INSERT INTO users(name, avatar_color, sort_order, portable_uuid, is_child) VALUES(?, ?, ?, ?, 1) RETURNING id",
).get("Downloads child", "#abcdef", 3, crypto.randomUUID()) as { id: number };

const addChannel = db.prepare(
  "INSERT INTO channels(channel_id, title, url, thumbnail, external) VALUES(?, ?, ?, ?, ?)",
);
addChannel.run("UC-rec-a", "Channel A", "https://youtube.com/channel/UC-rec-a", "a.jpg", 0);
addChannel.run("UC-rec-b", "Channel B", "https://youtube.com/channel/UC-rec-b", "b.jpg", 0);
addChannel.run("UC-rec-other", "Other profile only", "https://youtube.com/channel/UC-rec-other", "other.jpg", 0);
addChannel.run("UC-rec-unowned", "Unowned", "https://youtube.com/channel/UC-rec-unowned", "unowned.jpg", 0);

const follow = db.prepare("INSERT INTO user_channels(user_id, channel_id, followed) VALUES(?, ?, 1)");
follow.run(primaryId, "UC-rec-a");
follow.run(primaryId, "UC-rec-b");
follow.run(secondary.id, "UC-rec-other");
follow.run(child.id, "UC-rec-b");
follow.run(downloadsChild.id, "UC-rec-b");
await setUserSetting(child.id, "child_local_only", "1");
await setUserSetting(downloadsChild.id, "child_downloads_only", "1");

const publishedAt = new Date(Date.now() - 86_400_000).toISOString();
const addVideo = db.prepare(`
  INSERT INTO videos(
    video_id, channel_id, title, thumbnail, published_at,
    is_short, live_status, is_private, external
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
`);
const video = (
  id: string,
  channelId = "UC-rec-a",
  options: { title?: string; thumbnail?: string; isShort?: number | null; live?: string; private?: number } = {},
) => addVideo.run(
  id,
  channelId,
  options.title ?? `Video ${id}`,
  options.thumbnail === undefined ? `${id}.jpg` : options.thumbnail,
  publishedAt,
  options.isShort === undefined ? 0 : options.isShort,
  options.live ?? "none",
  options.private ?? 0,
);

video("rec-seed");
video("rec-fresh-a");
video("rec-fresh-b", "UC-rec-b");
video("rec-partial", "UC-rec-b");
video("rec-completed");
video("rec-near-complete");
video("rec-short", "UC-rec-a", { isShort: 1 });
video("rec-unknown-short", "UC-rec-a", { isShort: null });
video("rec-live", "UC-rec-a", { live: "live" });
video("rec-upcoming", "UC-rec-a", { live: "upcoming" });
video("rec-was-live", "UC-rec-a", { live: "was_live" });
video("rec-private", "UC-rec-a", { private: 1 });
video("rec-incomplete", "UC-rec-a", { thumbnail: "" });
video("rec-other-profile", "UC-rec-other");
video("rec-unowned", "UC-rec-unowned");

const tag = db.prepare(
  "INSERT INTO tags(name, color, user_id, portable_uuid) VALUES(?, ?, ?, ?) RETURNING id",
).get("Engineering", "#20c45a", primaryId, crypto.randomUUID()) as { id: number };
db.prepare("INSERT INTO channel_tags(channel_id, tag_id) VALUES(?, ?)").run("UC-rec-a", tag.id);
db.prepare("INSERT INTO channel_tags(channel_id, tag_id) VALUES(?, ?)").run("UC-rec-b", tag.id);

const addHistory = db.prepare("INSERT INTO history(video_id, user_id, watched_at) VALUES(?, ?, datetime('now'))");
addHistory.run("rec-seed", primaryId);
addHistory.run("rec-partial", primaryId);
addHistory.run("rec-other-profile", secondary.id);
db.prepare("INSERT INTO user_videos(user_id, video_id, watched) VALUES(?, ?, 1)").run(primaryId, "rec-seed");
db.prepare("INSERT INTO user_videos(user_id, video_id, watch_position, watch_duration) VALUES(?, ?, ?, ?)")
  .run(primaryId, "rec-partial", 420, 1000);
// An unfinished Short must not inflate the view-level "worth finishing"
// explanation because Shorts can never appear in recommendations.
db.prepare("INSERT INTO user_videos(user_id, video_id, watch_position, watch_duration) VALUES(?, ?, ?, ?)")
  .run(primaryId, "rec-short", 20, 100);
db.prepare("INSERT INTO user_videos(user_id, video_id, watched) VALUES(?, ?, 1)").run(primaryId, "rec-completed");
db.prepare("INSERT INTO user_videos(user_id, video_id, watch_position, watch_duration) VALUES(?, ?, ?, ?)")
  .run(primaryId, "rec-near-complete", 930, 1000);

const local = zonedDayHour();
db.prepare("INSERT INTO watch_time_log(user_id, video_id, day, hour, seconds) VALUES(?, ?, ?, ?, ?)")
  .run(primaryId, "rec-seed", local.day, local.hour, 900);
db.prepare("INSERT INTO watch_tag_time_log(user_id, tag_id, tag_name, tag_color, day, hour, seconds) VALUES(?, ?, ?, ?, ?, ?, ?)")
  .run(primaryId, tag.id, "Engineering", "#20c45a", local.day, local.hour, 900);

const request = (profileId: number, path: string) => api.request(`http://localhost${path}`, {
  headers: { Cookie: `ytzero_profile=${profileId}` },
});

const fullResponse = await request(primaryId, "/recommendations?limit=60");
const full = await fullResponse.json() as any;
const firstResponse = await request(primaryId, "/recommendations?limit=1&page=0");
const first = await firstResponse.json() as any;
const firstRepeat = await (await request(primaryId, "/recommendations?limit=1&page=0")).json() as any;
const secondResponse = await request(primaryId, "/recommendations?limit=1&page=1");
const secondPage = await secondResponse.json() as any;
const childResponse = await request(child.id, "/recommendations?limit=60");
const childData = await childResponse.json() as any;
const downloadsOnlyBefore = await (await request(downloadsChild.id, "/recommendations?limit=60")).json() as any;
db.prepare("INSERT INTO downloads(video_id, status, source) VALUES(?, 'done', 'manual')").run("rec-fresh-b");
db.prepare("INSERT INTO download_owners(user_id, video_id, source) VALUES(?, ?, 'manual')").run(downloadsChild.id, "rec-fresh-b");
const downloadsOnlyAfter = await (await request(downloadsChild.id, "/recommendations?limit=60")).json() as any;

console.log("RESULT " + JSON.stringify({
  fullStatus: fullResponse.status,
  ids: full.videos.map((item: any) => item.video_id),
  leaksRankingMetadata: full.videos.some((item: any) => "score" in item || "reasons" in item),
  everyRegular: full.videos.every((item: any) => item.is_short === 0 && item.live_status === "none"),
  summary: full.summary,
  externalEnabled: full.external_enabled,
  firstStatus: firstResponse.status,
  firstId: first.videos[0]?.video_id,
  firstRepeatId: firstRepeat.videos[0]?.video_id,
  firstHasMore: first.has_more,
  secondStatus: secondResponse.status,
  secondId: secondPage.videos[0]?.video_id,
  childStatus: childResponse.status,
  childEnabled: childData.enabled,
  childIds: childData.videos.map((item: any) => item.video_id),
  downloadsOnlyBefore: downloadsOnlyBefore.videos.map((item: any) => item.video_id),
  downloadsOnlyAfter: downloadsOnlyAfter.videos.map((item: any) => item.video_id),
}));

db.close();
