import { database } from "./database";
import { claimTubeArchivistWatchedState, enqueueTubeArchivistWatched } from "./tubeArchivist";

export async function completeVideo(userId: number, videoId: string): Promise<void> {
  await database.transaction(async () => {
    const previous = await database.prepare("SELECT watched FROM user_videos WHERE user_id=? AND video_id=?")
      .get(userId, videoId) as { watched: number | null } | null;
    await database.prepare(
      `INSERT INTO user_videos (user_id, video_id, watched) VALUES (?, ?, 1)
       ON CONFLICT(user_id, video_id) DO UPDATE SET watched = 1, playback_context_json = NULL`
    ).run(userId, videoId);
    await database.prepare("INSERT INTO history (video_id, user_id) VALUES (?, ?)").run(videoId, userId);
    await claimTubeArchivistWatchedState(userId, videoId);
    // Reasserting an already-watched value would unnecessarily move
    // TubeArchivist's watched_date and can interfere with its retention rules.
    if (previous?.watched !== 1) await enqueueTubeArchivistWatched(videoId, true);
  })();
}
