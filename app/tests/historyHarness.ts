const { api } = await import("../src/routes");
const { db } = await import("../src/db");

db.prepare("INSERT INTO channels(channel_id, title, url) VALUES(?, ?, ?)")
  .run("UChistory", "History channel", "https://youtube.com/channel/UChistory");
const secondary = db.prepare(
  "INSERT INTO users(name, avatar_color, sort_order, portable_uuid) VALUES(?, ?, ?, ?) RETURNING id",
).get("Secondary", "#123456", 1, crypto.randomUUID()) as { id: number };

const addVideo = db.prepare("INSERT INTO videos(video_id, channel_id, title) VALUES(?, ?, ?)");
const addHistory = db.prepare("INSERT INTO history(video_id, user_id, watched_at) VALUES(?, ?, ?)");

for (let index = 0; index < 61; index++) {
  const videoId = `history${String(index).padStart(4, "0")}`;
  const watchedAt = new Date(Date.UTC(2026, 6, 28, 12, -index)).toISOString().replace("T", " ").slice(0, 19);
  addVideo.run(videoId, "UChistory", `Video ${index}`);
  addHistory.run(videoId, 1, watchedAt);
}

// A repeat watch is represented by one card and should be removed with it.
addHistory.run("history0000", 1, "2026-01-01 00:00:00");
addHistory.run("history0000", secondary.id, "2026-07-20 00:00:00");

const request = (profileId: number, path: string, method = "GET") => api.request(`http://localhost${path}`, {
  method,
  headers: { Cookie: `ytzero_profile=${profileId}` },
});

const firstResponse = await request(1, "/history?page=0");
const first = await firstResponse.json() as any;
const secondResponse = await request(1, "/history?page=1");
const second = await secondResponse.json() as any;
const invalidPageResponse = await request(1, "/history?page=invalid");
const invalidPage = await invalidPageResponse.json() as any;

const historyId = first.videos.find((video: any) => video.video_id === "history0000").history_id;
const deleteResponse = await request(1, `/history/${historyId}`, "DELETE");

console.log("RESULT " + JSON.stringify({
  firstStatus: firstResponse.status,
  firstCount: first.videos.length,
  firstHasMore: first.has_more,
  secondStatus: secondResponse.status,
  secondCount: second.videos.length,
  secondHasMore: second.has_more,
  invalidPage: invalidPage.page,
  deleteStatus: deleteResponse.status,
  primaryRowsAfterDelete: (db.prepare("SELECT count(*) AS count FROM history WHERE user_id = 1 AND video_id = ?").get("history0000") as { count: number }).count,
  secondaryRowsAfterDelete: (db.prepare("SELECT count(*) AS count FROM history WHERE user_id = ? AND video_id = ?").get(secondary.id, "history0000") as { count: number }).count,
}));

db.close();
