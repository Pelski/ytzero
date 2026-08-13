import type { Context, Hono } from "hono";
import { database } from "../database";
import { isChildUser } from "../childTime";
import { createImportSession, deleteImportSession, getImportSession } from "../importSession";
import { log } from "../logger";
import { backfillImportedVideos, refreshAll } from "../refresher";
import {
  IMPORTED_CHANNEL_ID,
  isRelevantEntryName,
  isZip,
  parseTakeoutFiles,
  unzipEntries,
  type TakeoutBundle,
  type TakeoutHistoryEntry,
  type TakeoutPlaylist,
} from "../takeout";

type ApiEnvironment = { Variables: { userId: number; sessionAdmin?: boolean; profileAdmin?: boolean } };
type Api = Hono<ApiEnvironment>;
type ApiContext = Context<ApiEnvironment>;

export let importTakeoutHistory: (
  uid: number,
  entries: TakeoutHistoryEntry[],
  from: string | null,
) => Promise<{ historyAdded: number; watchedMarked: number }>;

export function registerImportRoutes(
  api: Api,
  currentUserId: (context: ApiContext) => number,
): void {

// ---------- Google Takeout and NewPipe import wizard ----------
// Two phases: /import/analyze parses the upload (zip or loose files) and holds
// it in an in-memory session; /import/commit applies only what the user picked.

const MAX_ZIP_BYTES = 300 * 1024 * 1024;

const ensureImportedChannel = database.prepare(
  `INSERT INTO channels (channel_id, title, url, followed, external) VALUES (?, ?, ?, 0, 1)
   ON CONFLICT(channel_id) DO NOTHING`
);
// Placeholder rows for videos we only know from the export. When the video is
// already in the library, fill only what's missing (title, real channel).
const ensureImportedVideo = database.prepare(
  `INSERT INTO videos (video_id, channel_id, title, thumbnail, status, external)
   VALUES (?, ?, ?, ?, 'inbox', 1)
   ON CONFLICT(video_id) DO UPDATE SET
     title = CASE WHEN TRIM(videos.title) = '' THEN excluded.title ELSE videos.title END,
     channel_id = CASE WHEN videos.channel_id = '${IMPORTED_CHANNEL_ID}' AND excluded.channel_id != '${IMPORTED_CHANNEL_ID}'
                       THEN excluded.channel_id ELSE videos.channel_id END`
);

async function importTakeoutPlaylists(uid: number, playlists: TakeoutPlaylist[]): Promise<{ playlistsCreated: number; videosAdded: number }> {
  const findPlaylist = database.prepare("SELECT id FROM user_playlists WHERE user_id = ? AND name = ? COLLATE NOCASE");
  const createPlaylist = database.prepare("INSERT INTO user_playlists (name, sort_order, user_id, portable_uuid) VALUES (?, ?, ?, ?) RETURNING id");
  const nextOrder = database.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM user_playlists WHERE user_id = ?");
  const addMembership = database.prepare("INSERT OR IGNORE INTO user_playlist_videos (playlist_id, video_id, added_at, position) VALUES (?, ?, COALESCE(?, datetime('now')), ?)");
  let playlistsCreated = 0;
  let videosAdded = 0;
  await database.transaction(async () => {
    await ensureImportedChannel.run(IMPORTED_CHANNEL_ID, "Imported", "");
    for (const pl of playlists) {
      let row = await findPlaylist.get(uid, pl.name) as { id: number } | undefined;
      if (!row) {
        const order = (await nextOrder.get(uid) as { n: number }).n;
        row = await createPlaylist.get(pl.name, order, uid, crypto.randomUUID()) as { id: number };
        playlistsCreated++;
      }
      for (const video of pl.videos) {
        await ensureImportedVideo.run(video.videoId, IMPORTED_CHANNEL_ID, "", `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`);
        // Existing memberships stay untouched; this is not a reimport/backfill.
        if ((await addMembership.run(row.id, video.videoId, video.addedAt, video.position)).changes > 0) videosAdded++;
      }
    }
  })();
  return { playlistsCreated, videosAdded };
}

// History rows carry the original watch date; undated entries (localized HTML
// exports) only mark the video as watched instead of faking a timestamp.
importTakeoutHistory = async (uid: number, entries: TakeoutHistoryEntry[], from: string | null): Promise<{ historyAdded: number; watchedMarked: number }> => {
  const existing = new Set(
    (await database.prepare("SELECT video_id, watched_at FROM history WHERE user_id = ?").all(uid) as { video_id: string; watched_at: string }[])
      .map((r) => `${r.video_id}@${r.watched_at}`)
  );
  const addHistory = database.prepare("INSERT INTO history (video_id, user_id, watched_at) VALUES (?, ?, ?)");
  const markWatched = database.prepare(
    `INSERT INTO user_videos (user_id, video_id, status, watched) VALUES (?, ?, 'archived', 1)
     ON CONFLICT(user_id, video_id) DO UPDATE SET
       status = 'archived', watched = 1, bucket = NULL, queued_at = NULL, show_from = NULL`
  );

  let historyAdded = 0;
  let watchedMarked = 0;
  await database.transaction(async () => {
    await ensureImportedChannel.run(IMPORTED_CHANNEL_ID, "Imported", "");
    for (const entry of entries) {
      if (entry.watchedAt ? (from !== null && entry.watchedAt < from) : from !== null) continue;
      const channelId = entry.channelId || IMPORTED_CHANNEL_ID;
      if (entry.channelId) {
        await ensureImportedChannel.run(entry.channelId, entry.channelTitle, `https://www.youtube.com/channel/${entry.channelId}`);
      }
      await ensureImportedVideo.run(entry.videoId, channelId, entry.title, `https://i.ytimg.com/vi/${entry.videoId}/hqdefault.jpg`);
      await markWatched.run(uid, entry.videoId);
      watchedMarked++;
      if (entry.watchedAt && !existing.has(`${entry.videoId}@${entry.watchedAt}`)) {
        existing.add(`${entry.videoId}@${entry.watchedAt}`);
        await addHistory.run(entry.videoId, uid, entry.watchedAt);
        historyAdded++;
      }
    }
  })();
  return { historyAdded, watchedMarked };
};

api.post("/import/analyze", async (c) => {
  const uid = currentUserId(c);
  if (await isChildUser(uid)) return c.json({ error: "not allowed" }, 403);
  const body = await c.req.parseBody({ all: true });
  const raw = body["file"] ?? body["file[]"];
  const uploads = (Array.isArray(raw) ? raw : [raw]).filter((f): f is File => f instanceof File);
  if (uploads.length === 0) return c.json({ error: "file required" }, 400);

  const files: { name: string; content: string }[] = [];
  for (const file of uploads) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (isZip(bytes)) {
      if (bytes.byteLength > MAX_ZIP_BYTES) return c.json({ error: "zip too large" }, 413);
      try {
        for (const entry of unzipEntries(bytes, isRelevantEntryName)) {
          files.push({ name: entry.name, content: new TextDecoder().decode(entry.bytes) });
        }
      } catch (e) {
        return c.json({ error: `could not read zip: ${e instanceof Error ? e.message : String(e)}` }, 400);
      }
    } else if (isRelevantEntryName(file.name)) {
      files.push({ name: file.name, content: new TextDecoder().decode(bytes) });
    }
  }

  const bundle = parseTakeoutFiles(files);
  if (bundle.channels.length === 0 && bundle.playlists.length === 0 && bundle.history.length === 0) {
    return c.json({ error: "nothing recognized in the upload" }, 400);
  }

  // Monthly histogram lets the UI show live counts for any date cutoff without
  // shipping the (potentially huge) entry list to the client.
  const months = new Map<string, number>();
  let undated = 0;
  for (const entry of bundle.history) {
    if (!entry.watchedAt) { undated++; continue; }
    const month = entry.watchedAt.slice(0, 7);
    months.set(month, (months.get(month) ?? 0) + 1);
  }
  const dated = bundle.history.filter((e) => e.watchedAt);

  const sessionId = createImportSession(uid, bundle);
  log.info("import.analyzed", { files: files.length, channels: bundle.channels.length, playlists: bundle.playlists.length, history: bundle.history.length });
  return c.json({
    sessionId,
    channels: bundle.channels,
    playlists: bundle.playlists.map((p) => ({ name: p.name, videoCount: p.videos.length })),
    history: {
      total: bundle.history.length,
      undated,
      from: dated.at(-1)?.watchedAt ?? null,
      to: dated[0]?.watchedAt ?? null,
      months: [...months.entries()].sort().map(([month, count]) => ({ month, count })),
    },
  });
});

api.post("/import/commit", async (c) => {
  const uid = currentUserId(c);
  if (await isChildUser(uid)) return c.json({ error: "not allowed" }, 403);
  const body = await c.req.json();
  const bundle: TakeoutBundle | null = typeof body.sessionId === "string" ? getImportSession(body.sessionId, uid) : null;
  if (!bundle) return c.json({ error: "session expired, upload the file again" }, 410);

  const result = { channelsAdded: 0, playlistsCreated: 0, playlistVideosAdded: 0, historyAdded: 0, watchedMarked: 0 };

  if (body.channels?.enabled) {
    const excluded = new Set<string>(Array.isArray(body.channels.excludedIds) ? body.channels.excludedIds : []);
    const insert = database.prepare("INSERT OR IGNORE INTO channels (channel_id, title, url) VALUES (?, ?, ?)");
    const subscribe = database.prepare(
      `INSERT INTO user_channels (user_id, channel_id, followed) VALUES (?, ?, 1)
       ON CONFLICT(user_id, channel_id) DO UPDATE SET followed = 1`
    );
    for (const ch of bundle.channels) {
      if (excluded.has(ch.channelId)) continue;
      await insert.run(ch.channelId, ch.title, `https://www.youtube.com/channel/${ch.channelId}`);
      await subscribe.run(uid, ch.channelId);
      result.channelsAdded++;
    }
    if (result.channelsAdded > 0) await database.prepare("UPDATE channels SET external = 0 WHERE channel_id IN (SELECT channel_id FROM user_channels WHERE user_id = ? AND followed = 1)").run(uid);
  }

  if (body.playlists?.enabled) {
    const excluded = new Set<string>(Array.isArray(body.playlists.excludedNames) ? body.playlists.excludedNames : []);
    const picked = bundle.playlists.filter((p) => !excluded.has(p.name));
    const r = await importTakeoutPlaylists(uid, picked);
    result.playlistsCreated = r.playlistsCreated;
    result.playlistVideosAdded = r.videosAdded;
  }

  if (body.history?.enabled) {
    // "from" arrives as YYYY-MM-DD; entries are YYYY-MM-DD HH:MM:SS so plain
    // string comparison works.
    const from = typeof body.history.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.history.from) ? body.history.from : null;
    const r = await importTakeoutHistory(uid, bundle.history, from);
    result.historyAdded = r.historyAdded;
    result.watchedMarked = r.watchedMarked;
  }

  deleteImportSession(body.sessionId);
  log.info("import.committed", { ...result });
  if (result.channelsAdded > 0) {
    refreshAll().catch((e) => log.error("import.refresh_failed", { error: e instanceof Error ? e.message : String(e) }));
  }
  if (result.playlistVideosAdded > 0 || result.watchedMarked > 0) {
    backfillImportedVideos().catch((e) => log.error("import.enrich_failed", { error: e instanceof Error ? e.message : String(e) }));
  }

  // Background-work forecast for the result screen. Enrichment and channel
  // refresh run in parallel on their own schedulers (see startScheduler), so
  // the UI can show how long until everything is filled in.
  const num = (v: string | undefined, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const enrichPending = (await database.prepare("SELECT COUNT(*) AS n FROM videos WHERE channel_id = ? AND is_private = 0 AND is_unavailable = 0").get(IMPORTED_CHANNEL_ID) as { n: number }).n;
  const enrichBatch = num(process.env.IMPORT_ENRICH_BATCH_SIZE, 15);
  const enrichIntervalMin = num(process.env.IMPORT_ENRICH_INTERVAL_MINUTES, 2);
  const refreshIntervalMin = num(process.env.REFRESH_INTERVAL_MINUTES, 5);
  const background = {
    enrichPending,
    enrichEstimateMin: Math.ceil(enrichPending / enrichBatch) * enrichIntervalMin,
    channelRefreshEstimateMin: Math.ceil(result.channelsAdded / 10) * refreshIntervalMin,
  };

  return c.json({ ok: true, ...result, background });
});

}
