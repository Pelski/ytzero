import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const { db } = await import("../src/db");
const { cleanupDownloadsNow, writeDownloadManifest } = await import("../src/downloader");

const downloadsDir = process.env.DOWNLOADS_DIR!;
const movedPath = join(downloadsDir, "moved.mp4");
const unknownPath = join(downloadsDir, "unknown.mp4");
const untrackedPath = join(downloadsDir, "personal-recording.mp4");
const legacyPath = join(downloadsDir, "Legacy Channel - Legacy title [legacy00001].mp4");
const oldManifestPath = join(downloadsDir, "old-video.mp4");
const currentPath = join(downloadsDir, "Current Channel - Existing download [current0001].mp4");
mkdirSync(dirname(movedPath), { recursive: true });
writeFileSync(movedPath, "recovered media");
writeDownloadManifest("recover001", movedPath, 15);
const groupedManifestPath = join(downloadsDir, "moved.ytz.json");
const writtenManifest = JSON.parse(readFileSync(groupedManifestPath, "utf8"));
writeFileSync(unknownPath, "keep this file");
writeFileSync(untrackedPath, "never delete unknown user data");
writeFileSync(legacyPath, "legacy media without a manifest");
writeFileSync(oldManifestPath, "media with an old manifest name");
writeFileSync(currentPath, "existing healthy download");
writeFileSync(join(downloadsDir, "unknown001.ytz.json"), JSON.stringify({
  schemaVersion: 1, videoId: "unknown001", file: "unknown.mp4", sizeBytes: 14, downloadedAt: "2026-08-02T00:00:00.000Z",
}));
writeFileSync(join(downloadsDir, "oldmanifest1.ytz.json"), JSON.stringify({
  schemaVersion: 1, videoId: "oldmanifest1", file: "old-video.mp4", sizeBytes: 31, downloadedAt: "2026-08-02T00:00:00.000Z",
}));

await db.prepare("INSERT INTO channels(channel_id,title,url) VALUES(?,?,?)").run("UCrecovery", "Recovery", "");
await db.prepare("INSERT INTO videos(video_id,channel_id,title) VALUES(?,?,?)").run("recover001", "UCrecovery", "Recovery test");
await db.prepare("INSERT INTO videos(video_id,channel_id,title) VALUES(?,?,?),(?,?,?),(?,?,?)").run("legacy00001", "UCrecovery", "Legacy recovery", "oldmanifest1", "UCrecovery", "Old manifest recovery", "current0001", "UCrecovery", "Existing download");
await db.prepare("INSERT INTO downloads(video_id,status,path,size_bytes) VALUES(?, 'deleted', ?, ?)").run("recover001", "/old/downloads/moved.mp4", 1);
await db.prepare("INSERT INTO downloads(video_id,status,path,size_bytes) VALUES(?, 'deleted', ?, ?),(?, 'deleted', ?, ?)").run("legacy00001", "/old/downloads/legacy.mp4", 1, "oldmanifest1", "/old/downloads/old-video.mp4", 1);
await db.prepare("INSERT INTO downloads(video_id,status,path,size_bytes) VALUES(?, 'done', ?, ?)").run("current0001", currentPath, 25);

await cleanupDownloadsNow();
const recovered = await db.prepare("SELECT status,path,size_bytes FROM downloads WHERE video_id=?").get("recover001");
const legacyRecovered = await db.prepare("SELECT status,path,size_bytes FROM downloads WHERE video_id=?").get("legacy00001");
const oldManifestRecovered = await db.prepare("SELECT status,path,size_bytes FROM downloads WHERE video_id=?").get("oldmanifest1");
const currentManifestPath = join(downloadsDir, "Current Channel - Existing download [current0001].ytz.json");
console.log("RESULT " + JSON.stringify({
  recovered,
  legacyRecovered,
  oldManifestRecovered,
  writtenManifest,
  groupedManifest: existsSync(groupedManifestPath),
  legacyManifestCreated: existsSync(join(downloadsDir, "Legacy Channel - Legacy title [legacy00001].ytz.json")),
  oldManifestGrouped: existsSync(join(downloadsDir, "old-video.ytz.json")) && !existsSync(join(downloadsDir, "oldmanifest1.ytz.json")),
  currentManifest: existsSync(currentManifestPath) ? JSON.parse(readFileSync(currentManifestPath, "utf8")) : null,
  unknownPreserved: existsSync(unknownPath),
  untrackedPreserved: existsSync(untrackedPath),
}));
await db.close();
