import { database } from "./database";
import { enqueueTubeArchivistWatched } from "./tubeArchivist";

export async function completeVideo(userId: number, videoId: string): Promise<void> {
  await database.transaction(async () => {
    await database.prepare(
      `INSERT INTO user_videos (user_id, video_id, watched) VALUES (?, ?, 1)
       ON CONFLICT(user_id, video_id) DO UPDATE SET watched = 1, playback_context_json = NULL`
    ).run(userId, videoId);
    await database.prepare("INSERT INTO history (video_id, user_id) VALUES (?, ?)").run(videoId, userId);
    await enqueueTubeArchivistWatched(videoId);
  })();
}
