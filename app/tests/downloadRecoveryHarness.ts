import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const { db } = await import("../src/db");
const { cleanupDownloadsNow } = await import("../src/downloader");

const downloadsDir = process.env.DOWNLOADS_DIR!;
const movedPath = join(downloadsDir, "moved.mp4");
const unknownPath = join(downloadsDir, "unknown.mp4");
mkdirSync(dirname(movedPath), { recursive: true });
writeFileSync(movedPath, "recovered media");
writeFileSync(join(downloadsDir, "recover001.ytz.json"), JSON.stringify({
  schemaVersion: 1, videoId: "recover001", file: "moved.mp4", sizeBytes: 15, downloadedAt: "2026-08-02T00:00:00.000Z",
}));
writeFileSync(unknownPath, "keep this file");
writeFileSync(join(downloadsDir, "unknown001.ytz.json"), JSON.stringify({
  schemaVersion: 1, videoId: "unknown001", file: "unknown.mp4", sizeBytes: 14, downloadedAt: "2026-08-02T00:00:00.000Z",
}));

await db.prepare("INSERT INTO channels(channel_id,title,url) VALUES(?,?,?)").run("UCrecovery", "Recovery", "");
await db.prepare("INSERT INTO videos(video_id,channel_id,title) VALUES(?,?,?)").run("recover001", "UCrecovery", "Recovery test");
await db.prepare("INSERT INTO downloads(video_id,status,path,size_bytes) VALUES(?, 'deleted', ?, ?)").run("recover001", "/old/downloads/moved.mp4", 1);

await cleanupDownloadsNow();
const recovered = await db.prepare("SELECT status,path,size_bytes FROM downloads WHERE video_id=?").get("recover001");
console.log("RESULT " + JSON.stringify({ recovered, unknownPreserved: existsSync(unknownPath) }));
await db.close();
