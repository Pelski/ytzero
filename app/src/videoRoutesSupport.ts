import { database } from "./database";
import { isChildUser } from "./childTime";
import { activeDownloadProgress } from "./downloader";
import { parsePlaybackContext } from "./playbackContext";
export { videoSelect } from "./videoSelect";
export const videoExistsStmt = database.prepare("SELECT 1 FROM videos WHERE video_id = ?");
export interface VideoRow {
  video_id: string;
  channel_id: string;
  title: string;
  description: string;
  thumbnail: string;
  published_at: string | null;
  found_at: string;
  published_at_approximate: number;
  members_only: number;
  is_private: number;
  is_unavailable?: number;
  live_status: string;
  status: string;
  bucket: string | null;
  is_short: number | null;
  views: number | null;
  likes: number | null;
  liked: number | null;
  watched: number | null;
  playback_context_json?: string | null;
  in_history: number;
  channel_title: string;
}
export async function attachWatchedState<T>(uid: number, items: T[], videoId: (item: T) => string | null | undefined) {
  const ids = [...new Set(items.map(videoId).filter((id): id is string => !!id))];
  if (ids.length === 0) return items.map((item) => ({ ...item, watched: 0, watch_position: null, watch_duration: null }));
  const placeholders = ids.map(() => "?").join(",");
  const rows = await database.prepare(
    `SELECT video_id, watched, watch_position, watch_duration
     FROM user_videos WHERE user_id = ? AND video_id IN (${placeholders})`
  ).all(uid, ...ids) as { video_id: string; watched: number | null; watch_position: number | null; watch_duration: number | null }[];
  const state = new Map(rows.map((row) => [row.video_id, row]));
  return items.map((item) => {
    const progress = state.get(videoId(item) ?? "");
    return {
      ...item,
      watched: progress?.watched === 1 ? 1 : 0,
      watch_position: progress?.watch_position ?? null,
      watch_duration: progress?.watch_duration ?? null,
    };
  });
}

export async function attachTags(uid: number, videos: VideoRow[], profileDownloadsEnabled: (userId: number) => Promise<boolean>) {
  if (videos.length === 0) return [];
  // downloads_allowed: the profile may use downloads at all (not a child);
  // downloads_enabled additionally requires the feature to be turned on. The UI
  // shows the download action for allowed-but-disabled and links to settings.
  const downloadsAllowed = !await isChildUser(uid);
  const downloadsEnabled = downloadsAllowed && await profileDownloadsEnabled(uid);
  // Live percentage for the one video the downloader is fetching right now,
  // so lists can paint a download progress bar without a dedicated request.
  const dlProgress = activeDownloadProgress();
  const ids = videos.map((v) => v.video_id);
  const ph = ids.map(() => "?").join(",");
  // Tags are per profile: only surface tags owned by the active user.
  const videoTags = await database
    .prepare(
      `SELECT vt.video_id, t.id, t.name, t.color, t.filter_only, vt.source FROM video_tags vt
       JOIN tags t ON t.id = vt.tag_id AND t.user_id = ? WHERE vt.video_id IN (${ph})`
    )
    .all(uid, ...ids) as any[];
  const channelIds = [...new Set(videos.map((v) => v.channel_id))];
  const chPh = channelIds.map(() => "?").join(",");
  const channelTags = await database
    .prepare(
      `SELECT ct.channel_id, t.id, t.name, t.color, t.filter_only FROM channel_tags ct
       JOIN tags t ON t.id = ct.tag_id AND t.user_id = ? WHERE ct.channel_id IN (${chPh})`
    )
    .all(uid, ...channelIds) as any[];
  const playlistChannelTags = await database
    .prepare(
      `SELECT DISTINCT cpv.video_id, t.id, t.name, t.color, t.filter_only
       FROM channel_playlist_videos cpv
       JOIN channel_playlists cp ON cp.playlist_id = cpv.playlist_id
       JOIN user_followed_playlists ufp ON ufp.playlist_id = cp.playlist_id AND ufp.user_id = ?
       JOIN channel_tags ct ON ct.channel_id = cp.channel_id
       JOIN tags t ON t.id = ct.tag_id AND t.user_id = ?
       WHERE cpv.video_id IN (${ph})`
    )
    .all(uid, uid, ...ids) as any[];

  return videos.map((v) => {
    const own = videoTags
      .filter((t) => t.video_id === v.video_id)
      .map((t) => ({ id: t.id, name: t.name, color: t.color, filter_only: t.filter_only, source: t.source }));
    const inherited = channelTags
      .filter((t) => t.channel_id === v.channel_id && !own.some((o) => o.id === t.id))
      .map((t) => ({ id: t.id, name: t.name, color: t.color, filter_only: t.filter_only, source: "channel" }));
    const playlistInherited = playlistChannelTags
      .filter((t) => t.video_id === v.video_id && !own.some((o) => o.id === t.id) && !inherited.some((i) => i.id === t.id))
      .map((t) => ({ id: t.id, name: t.name, color: t.color, filter_only: t.filter_only, source: "channel" }));
    const download_progress = (v as any).download_status === "downloading" && dlProgress?.video_id === v.video_id
      ? dlProgress.percent
      : null;
    const { playback_context_json, ...video } = v;
    return { ...video, playback_context: parsePlaybackContext(playback_context_json), downloads_enabled: downloadsEnabled, downloads_allowed: downloadsAllowed, download_progress, tags: [...own, ...inherited, ...playlistInherited] };
  });
}
