import { database } from "./database";
import { effectiveVideoTagsCte } from "./insightTags";
import { zonedDayHour } from "./timeZone";

interface EffectiveTagSnapshot {
  id: number;
  name: string;
  color: string;
}

const WATCH_TAG_CACHE_MS = 60_000;
const watchTagCache = new Map<string, { at: number; tags: EffectiveTagSnapshot[] }>();

const effectiveTagsForVideo = database.prepare(`${effectiveVideoTagsCte}
  SELECT tag_id AS id, name, color
  FROM effective_video_tags
  WHERE video_id = ? AND user_id = ?
  ORDER BY lower(name), tag_id
`);

const videoChannel = database.prepare("SELECT channel_id FROM videos WHERE video_id = ?");
const insertSchedulingEvent = database.prepare(`
  INSERT INTO scheduling_event_log (user_id, video_id, channel_id, bucket, tags_json, local_day, local_hour)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const upsertWatchTagTime = database.prepare(`
  INSERT INTO watch_tag_time_log (user_id, tag_id, tag_name, tag_color, day, hour, seconds)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(user_id, tag_id, day, hour) DO UPDATE SET
    tag_name = excluded.tag_name,
    tag_color = excluded.tag_color,
    seconds = watch_tag_time_log.seconds + excluded.seconds
`);

async function tagsForVideo(userId: number, videoId: string, cached = false): Promise<EffectiveTagSnapshot[]> {
  const key = `${userId}:${videoId}`;
  const existing = watchTagCache.get(key);
  if (cached && existing && Date.now() - existing.at < WATCH_TAG_CACHE_MS) return existing.tags;
  const tags = await effectiveTagsForVideo.all(videoId, userId) as EffectiveTagSnapshot[];
  if (cached) watchTagCache.set(key, { at: Date.now(), tags });
  return tags;
}

/** Append one explicit queue/scheduling decision with its tag context. */
export async function recordSchedulingSignal(userId: number, videoId: string, bucket: string): Promise<boolean> {
  const video = await videoChannel.get(videoId) as { channel_id: string } | null;
  if (!video) return false;
  const local = zonedDayHour();
  await insertSchedulingEvent.run(userId, videoId, video.channel_id, bucket, JSON.stringify(await tagsForVideo(userId, videoId)), local.day, local.hour);
  return true;
}

/** Attribute a real playback delta to every effective tag active at the time. */
export async function recordWatchTagSignals(
  userId: number,
  videoId: string,
  seconds: number,
  local = zonedDayHour(),
): Promise<number> {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  const tags = await tagsForVideo(userId, videoId, true);
  await database.transaction(async (items: EffectiveTagSnapshot[]) => {
    for (const tag of items) await upsertWatchTagTime.run(userId, tag.id, tag.name, tag.color, local.day, local.hour, seconds);
  })(tags);
  return tags.length;
}
