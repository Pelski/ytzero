const { api, importTakeoutHistory } = await import("../src/routes");
const { db } = await import("../src/db");

const channelId = "UCaaaaaaaaaaaaaaaaaaaaaa";
db.prepare("INSERT INTO channels(channel_id, title, url) VALUES(?, ?, ?)")
  .run(channelId, "Feed import channel", `https://youtube.com/channel/${channelId}`);
db.prepare("INSERT INTO user_channels(user_id, channel_id, followed) VALUES(1, ?, 1)").run(channelId);

const addVideo = db.prepare(
  "INSERT INTO videos(video_id, channel_id, title, published_at) VALUES(?, ?, ?, ?)",
);
addVideo.run("feed-new-01", channelId, "Unwatched", "2026-07-30 12:00:00");
addVideo.run("feed-old-01", channelId, "Legacy watched inbox", "2026-07-29 12:00:00");
addVideo.run("feed-imp-01", channelId, "Imported queued", "2026-07-28 12:00:00");

db.prepare("INSERT INTO user_videos(user_id, video_id, status, watched) VALUES(1, ?, 'inbox', 1)")
  .run("feed-old-01");
db.prepare(
  "INSERT INTO user_videos(user_id, video_id, status, bucket, queued_at, show_from) VALUES(1, ?, 'queued', 'today', datetime('now'), datetime('now'))",
).run("feed-imp-01");

const imported = await importTakeoutHistory(1, [{
  videoId: "feed-imp-01",
  watchedAt: "2026-07-28 13:00:00",
  title: "Imported queued",
  channelId,
  channelTitle: "Feed import channel",
}], null);

const requestFeed = async (suffix = "") => {
  const response = await api.request(`http://localhost/feed${suffix}`, {
    headers: { Cookie: "ytzero_profile=1" },
  });
  return await response.json() as { videos: { video_id: string }[] };
};

const feed = await requestFeed();
const showAllFeed = await requestFeed("?show_all=1");
const importedState = db.prepare(
  "SELECT status, watched, bucket, queued_at, show_from FROM user_videos WHERE user_id = 1 AND video_id = ?",
).get("feed-imp-01");

console.log("RESULT " + JSON.stringify({
  imported,
  importedState,
  feedIds: feed.videos.map((video) => video.video_id),
  showAllFeedIds: showAllFeed.videos.map((video) => video.video_id),
  importedHistoryRows: (db.prepare(
    "SELECT count(*) AS count FROM history WHERE user_id = 1 AND video_id = ?",
  ).get("feed-imp-01") as { count: number }).count,
}));

db.close();
