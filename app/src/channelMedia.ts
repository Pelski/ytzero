import { db } from "./db";
import { getCachedImage } from "./imgcache";
import type { ChannelAbout, PlaylistInfo } from "./youtube";

async function keepVerifiedReplacement(candidate: string, fallback: string): Promise<string> {
  if (!candidate) return fallback;
  if (candidate === fallback) return candidate;
  const cached = await getCachedImage(candidate);
  // For a brand-new channel there is no last known good URL, so retain the
  // candidate and let the browser try the origin directly. Existing media is
  // replaced only after the new file has been verified and cached locally.
  return cached ? candidate : fallback || candidate;
}

export async function preserveChannelMedia(channelId: string, incoming: ChannelAbout): Promise<ChannelAbout> {
  const row = db.prepare("SELECT thumbnail, about_json FROM channels WHERE channel_id = ?")
    .get(channelId) as { thumbnail: string | null; about_json: string | null } | null;
  let previous: Partial<ChannelAbout> = {};
  if (row?.about_json) {
    try { previous = JSON.parse(row.about_json) as Partial<ChannelAbout>; } catch {}
  }
  const previousAvatar = previous.avatar || row?.thumbnail || "";
  const previousBanner = previous.banner || "";
  const [avatar, banner] = await Promise.all([
    keepVerifiedReplacement(incoming.avatar, previousAvatar),
    keepVerifiedReplacement(incoming.banner, previousBanner),
  ]);
  return { ...incoming, avatar, banner };
}

export async function preservePlaylistMedia(channelId: string, incoming: PlaylistInfo[]): Promise<PlaylistInfo[]> {
  const previous = new Map(
    (db.prepare("SELECT playlist_id, thumbnail FROM channel_playlists WHERE channel_id = ?").all(channelId) as { playlist_id: string; thumbnail: string }[])
      .map((playlist) => [playlist.playlist_id, playlist.thumbnail]),
  );
  const safe: PlaylistInfo[] = [];
  // A small concurrency window verifies changed playlist covers without
  // turning a channel refresh into a burst of image downloads.
  for (let index = 0; index < incoming.length; index += 4) {
    safe.push(...await Promise.all(incoming.slice(index, index + 4).map(async (playlist) => {
      const previousThumbnail = previous.get(playlist.playlistId) ?? "";
      return {
        ...playlist,
        thumbnail: previousThumbnail
          ? await keepVerifiedReplacement(playlist.thumbnail, previousThumbnail)
          : playlist.thumbnail,
      };
    })));
  }
  return safe;
}
