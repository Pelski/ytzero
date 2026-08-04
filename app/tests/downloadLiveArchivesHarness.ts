const { db } = await import("../src/db");
const { enqueueDownload } = await import("../src/downloader");
const { enqueueScheduledDownloadsForUser } = await import("../src/scheduledDownloads");

db.prepare("INSERT INTO channels(channel_id,title,url) VALUES('UC-live-downloads','Live downloads','')").run();
const insertVideo = db.prepare("INSERT INTO videos(video_id,channel_id,title,thumbnail,live_status) VALUES(?,'UC-live-downloads',?,'',?)");
for (const [videoId, liveStatus] of [
  ["scheduled-regular", "none"],
  ["scheduled-live", "live"],
  ["scheduled-upcoming", "upcoming"],
  ["scheduled-live-archive", "was_live"],
] as const) {
  insertVideo.run(videoId, videoId, liveStatus);
  db.prepare("INSERT INTO user_videos(user_id,video_id,status,queued_at) VALUES(1,?,'queued',datetime('now'))").run(videoId);
}
db.prepare("INSERT INTO download_settings(user_id,key,value) VALUES(1,'enabled','1') ON CONFLICT(user_id,key) DO UPDATE SET value='1'").run();

const enqueueScheduled = (userId: number, videoId: string) => enqueueDownload(userId, videoId, "scheduled", false, true);
const queuedWithDefault = await enqueueScheduledDownloadsForUser(1, enqueueScheduled);
const defaultDownloads = db.prepare("SELECT video_id FROM downloads ORDER BY video_id").all();

db.prepare("INSERT INTO download_settings(user_id,key,value) VALUES(1,'download_live_archives','1') ON CONFLICT(user_id,key) DO UPDATE SET value='1'").run();
const queuedAfterOptIn = await enqueueScheduledDownloadsForUser(1, enqueueScheduled);
const optedInDownloads = db.prepare("SELECT video_id FROM downloads ORDER BY video_id").all();

console.log("RESULT " + JSON.stringify({ queuedWithDefault, defaultDownloads, queuedAfterOptIn, optedInDownloads }));
db.close();
