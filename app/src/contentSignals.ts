import { db } from "./db";
import { effectiveVideoTagsCte } from "./insightTags";

interface EffectiveTagSnapshot {
  id: number;
  name: string;
  color: string;
}

const WATCH_TAG_CACHE_MS = 60_000;
const watchTagCache = new Map<string, { at: number; tags: EffectiveTagSnapshot[] }>();

const effectiveTagsForVideo = db.prepare(`${effectiveVideoTagsCte}
  SELECT tag_id AS id, name, color
  FROM effective_video_tags
  WHERE video_id = ? AND user_id = ?
  ORDER BY lower(name), tag_id
`);

const videoChannel = db.prepare("SELECT channel_id FROM videos WHERE video_id = ?");
const insertSchedulingEvent = db.prepare(`
  INSERT INTO scheduling_event_log (user_id, video_id, channel_id, bucket, tags_json)
  VALUES (?, ?, ?, ?, ?)
`);

const upsertWatchTagTime = db.prepare(`
  INSERT INTO watch_tag_time_log (user_id, tag_id, tag_name, tag_color, day, hour, seconds)
  VALUES (?, ?, ?, ?, date('now','localtime'), CAST(strftime('%H','now','localtime') AS INTEGER), ?)
  ON CONFLICT(user_id, tag_id, day, hour) DO UPDATE SET
    tag_name = excluded.tag_name,
    tag_color = excluded.tag_color,
    seconds = watch_tag_time_log.seconds + excluded.seconds
`);

function tagsForVideo(userId: number, videoId: string, cached = false): EffectiveTagSnapshot[] {
  const key = `${userId}:${videoId}`;
  const existing = watchTagCache.get(key);
  if (cached && existing && Date.now() - existing.at < WATCH_TAG_CACHE_MS) return existing.tags;
  const tags = effectiveTagsForVideo.all(videoId, userId) as EffectiveTagSnapshot[];
  if (cached) watchTagCache.set(key, { at: Date.now(), tags });
  return tags;
}

/** Append one explicit queue/scheduling decision with its tag context. */
export function recordSchedulingSignal(userId: number, videoId: string, bucket: string): boolean {
  const video = videoChannel.get(videoId) as { channel_id: string } | null;
  if (!video) return false;
  insertSchedulingEvent.run(userId, videoId, video.channel_id, bucket, JSON.stringify(tagsForVideo(userId, videoId)));
  return true;
}

/** Attribute a real playback delta to every effective tag active at the time. */
export function recordWatchTagSignals(userId: number, videoId: string, seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  const tags = tagsForVideo(userId, videoId, true);
  db.transaction((items: EffectiveTagSnapshot[]) => {
    for (const tag of items) upsertWatchTagTime.run(userId, tag.id, tag.name, tag.color, seconds);
  })(tags);
  return tags.length;
}
