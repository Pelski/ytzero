import { randomBytes } from "node:crypto";
import { database } from "./database";
import { hasPermission } from "./accessControl";
import { profileVideoOwnershipExists } from "./feedQuery";

export const PUBLIC_SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const PUBLIC_SHARE_PAGE_SIZE = 60;

export type PublicShareResourceType = "video" | "user_playlist" | "followed_playlist";

export interface PublicShareRow {
  id: string;
  token: string;
  owner_user_id: number;
  resource_type: PublicShareResourceType;
  resource_id: string;
  allow_local_media: number;
  created_at: string;
  updated_at: string;
  owner_name?: string;
}

export interface PublicShareResourceSummary {
  title: string;
  video_count: number;
}

export interface ResolvedPublicShare {
  share: PublicShareRow;
  resource: PublicShareResourceSummary;
}

export interface PublicShareVideo {
  video_id: string;
  channel_id: string;
  title: string;
  description: string;
  thumbnail: string;
  published_at: string | null;
  published_at_approximate: number;
  live_status: string;
  duration: string | null;
  views: number | null;
  likes: number | null;
  channel_title: string;
  chapters_json: string | null;
}

export interface PublicShareCreator {
  channel_id: string;
  title: string;
  thumbnail: string;
  handle: string;
  subscriber_count: string;
  is_owner: number;
}

export class PublicShareError extends Error {
  constructor(public readonly status: 400 | 403 | 404 | 409, public readonly code: string, message: string) {
    super(message);
    this.name = "PublicShareError";
  }
}

const PUBLIC_VIDEO_FILTER = `
  COALESCE(v.is_private, 0) = 0
  AND COALESCE(v.is_unavailable, 0) = 0
  AND COALESCE(v.members_only, 0) = 0
`;

export function isPublicShareResourceType(value: unknown): value is PublicShareResourceType {
  return value === "video" || value === "user_playlist" || value === "followed_playlist";
}

export function createPublicShareToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function publicSharingEnabled(): Promise<boolean> {
  const row = await database.prepare("SELECT enabled FROM public_share_policy WHERE singleton=1").get<{ enabled: number }>();
  return row?.enabled === 1;
}

export async function setPublicSharingEnabled(enabled: boolean): Promise<void> {
  const now = new Date().toISOString();
  await database.prepare(`
    INSERT INTO public_share_policy(singleton,enabled,updated_at) VALUES(1,?,?)
    ON CONFLICT(singleton) DO UPDATE SET enabled=excluded.enabled,updated_at=excluded.updated_at
  `).run(enabled ? 1 : 0, now);
}

/** Public requests have no session. Only durable profile administrator grants
 * can bypass the profile permission during later bearer-link resolution. */
export async function profileCanPublishPublicShares(userId: number): Promise<boolean> {
  const row = await database.prepare(`
    SELECT id,is_admin,(SELECT MIN(id) FROM users) AS primary_id FROM users WHERE id=?
  `).get<{ id: number; is_admin: number; primary_id: number }>(userId);
  if (!row) return false;
  if (row.id === row.primary_id || row.is_admin === 1) return true;
  return hasPermission(userId, "public_sharing");
}

async function resourceSummary(ownerUserId: number, resourceType: PublicShareResourceType, resourceId: string): Promise<PublicShareResourceSummary | null> {
  if (resourceType === "video") {
    const row = await database.prepare(`
      SELECT v.title FROM videos v
      WHERE v.video_id=? AND ${PUBLIC_VIDEO_FILTER} AND ${profileVideoOwnershipExists(ownerUserId)}
    `).get<{ title: string }>(resourceId);
    return row ? { title: row.title, video_count: 1 } : null;
  }
  if (resourceType === "user_playlist") {
    const row = await database.prepare(`
      SELECT playlist.name AS title,
             COUNT(CASE WHEN ${PUBLIC_VIDEO_FILTER} THEN video.video_id END) AS video_count
      FROM user_playlists playlist
      LEFT JOIN user_playlist_videos member ON member.playlist_id=playlist.id
      LEFT JOIN videos video ON video.video_id=member.video_id
      LEFT JOIN videos v ON v.video_id=video.video_id
      WHERE playlist.id=? AND playlist.user_id=?
      GROUP BY playlist.id,playlist.name
    `).get<{ title: string; video_count: number | string }>(resourceId, ownerUserId);
    return row ? { title: row.title, video_count: Number(row.video_count) } : null;
  }
  const row = await database.prepare(`
    SELECT playlist.title,
           COUNT(CASE WHEN ${PUBLIC_VIDEO_FILTER} THEN video.video_id END) AS video_count
    FROM user_followed_playlists followed
    JOIN channel_playlists playlist ON playlist.playlist_id=followed.playlist_id
    LEFT JOIN channel_playlist_videos member ON member.playlist_id=playlist.playlist_id
    LEFT JOIN videos video ON video.video_id=member.video_id
    LEFT JOIN videos v ON v.video_id=video.video_id
    WHERE followed.user_id=? AND followed.playlist_id=?
    GROUP BY playlist.playlist_id,playlist.title
  `).get<{ title: string; video_count: number | string }>(ownerUserId, resourceId);
  return row ? { title: row.title, video_count: Number(row.video_count) } : null;
}

async function resourceStillExists(resourceType: PublicShareResourceType, resourceId: string): Promise<boolean> {
  const table = resourceType === "video" ? "videos" : resourceType === "user_playlist" ? "user_playlists" : "channel_playlists";
  const column = resourceType === "video" ? "video_id" : resourceType === "user_playlist" ? "id" : "playlist_id";
  return Boolean(await database.prepare(`SELECT 1 FROM ${table} WHERE ${column}=?`).get(resourceId));
}

async function removeTerminatedShare(share: PublicShareRow): Promise<boolean> {
  if (await resourceStillExists(share.resource_type, share.resource_id)) return false;
  await database.prepare("DELETE FROM public_shares WHERE id=?").run(share.id);
  return true;
}

async function removeTerminatedShares(): Promise<void> {
  await database.prepare(`
    DELETE FROM public_shares
    WHERE (resource_type='video' AND NOT EXISTS (SELECT 1 FROM videos WHERE videos.video_id=public_shares.resource_id))
       OR (resource_type='user_playlist' AND NOT EXISTS (SELECT 1 FROM user_playlists WHERE CAST(user_playlists.id AS TEXT)=public_shares.resource_id))
       OR (resource_type='followed_playlist' AND NOT EXISTS (SELECT 1 FROM channel_playlists WHERE channel_playlists.playlist_id=public_shares.resource_id))
  `).run();
}

export async function resolvePublicShare(token: string): Promise<ResolvedPublicShare | null> {
  if (!PUBLIC_SHARE_TOKEN_PATTERN.test(token) || !await publicSharingEnabled()) return null;
  const share = await database.prepare(`
    SELECT id,token,owner_user_id,resource_type,resource_id,allow_local_media,created_at,updated_at
    FROM public_shares WHERE token=?
  `).get<PublicShareRow>(token);
  if (!share || await removeTerminatedShare(share) || !await profileCanPublishPublicShares(share.owner_user_id)) return null;
  const resource = await resourceSummary(share.owner_user_id, share.resource_type, share.resource_id);
  if (!resource) {
    await removeTerminatedShare(share);
    return null;
  }
  return { share, resource };
}

export async function publicShareResourceIsValid(ownerUserId: number, resourceType: PublicShareResourceType, resourceId: string): Promise<boolean> {
  return Boolean(await resourceSummary(ownerUserId, resourceType, resourceId));
}

export async function publicShareContainsVideo(share: PublicShareRow, videoId: string): Promise<boolean> {
  if (share.resource_type === "video") {
    return share.resource_id === videoId && Boolean(await database.prepare(`
      SELECT 1 FROM videos v WHERE v.video_id=? AND ${PUBLIC_VIDEO_FILTER} AND ${profileVideoOwnershipExists(share.owner_user_id)}
    `).get(videoId));
  }
  if (share.resource_type === "user_playlist") {
    return Boolean(await database.prepare(`
      SELECT 1 FROM user_playlists playlist
      JOIN user_playlist_videos member ON member.playlist_id=playlist.id
      JOIN videos v ON v.video_id=member.video_id
      WHERE playlist.id=? AND playlist.user_id=? AND member.video_id=? AND ${PUBLIC_VIDEO_FILTER}
    `).get(share.resource_id, share.owner_user_id, videoId));
  }
  return Boolean(await database.prepare(`
    SELECT 1 FROM user_followed_playlists followed
    JOIN channel_playlist_videos member ON member.playlist_id=followed.playlist_id
    JOIN videos v ON v.video_id=member.video_id
    WHERE followed.user_id=? AND followed.playlist_id=? AND member.video_id=? AND ${PUBLIC_VIDEO_FILTER}
  `).get(share.owner_user_id, share.resource_id, videoId));
}

export async function publicShareVideoIds(share: PublicShareRow, page: number): Promise<string[]> {
  if (share.resource_type === "video") return await publicShareContainsVideo(share, share.resource_id) ? [share.resource_id] : [];
  const offset = page * PUBLIC_SHARE_PAGE_SIZE;
  if (share.resource_type === "user_playlist") {
    const rows = await database.prepare(`
      SELECT member.video_id FROM user_playlists playlist
      JOIN user_playlist_videos member ON member.playlist_id=playlist.id
      JOIN videos v ON v.video_id=member.video_id
      WHERE playlist.id=? AND playlist.user_id=? AND ${PUBLIC_VIDEO_FILTER}
      ORDER BY member.position,member.added_at,member.video_id
      LIMIT ? OFFSET ?
    `).all<{ video_id: string }>(share.resource_id, share.owner_user_id, PUBLIC_SHARE_PAGE_SIZE, offset);
    return rows.map((row) => row.video_id);
  }
  const rows = await database.prepare(`
    SELECT member.video_id FROM user_followed_playlists followed
    JOIN channel_playlist_videos member ON member.playlist_id=followed.playlist_id
    JOIN videos v ON v.video_id=member.video_id
    WHERE followed.user_id=? AND followed.playlist_id=? AND ${PUBLIC_VIDEO_FILTER}
    ORDER BY member.position,member.discovered_at,member.video_id
    LIMIT ? OFFSET ?
  `).all<{ video_id: string }>(share.owner_user_id, share.resource_id, PUBLIC_SHARE_PAGE_SIZE, offset);
  return rows.map((row) => row.video_id);
}

export async function publicShareVideo(videoId: string): Promise<PublicShareVideo | null> {
  return database.prepare(`
    SELECT v.video_id,v.channel_id,v.title,v.description,v.thumbnail,v.published_at,
           COALESCE(v.published_at_approximate,0) AS published_at_approximate,
           v.live_status,v.duration,v.views,v.likes,v.chapters_json,c.title AS channel_title
    FROM videos v JOIN channels c ON c.channel_id=v.channel_id
    WHERE v.video_id=? AND ${PUBLIC_VIDEO_FILTER}
  `).get<PublicShareVideo>(videoId);
}

export async function publicShareCreators(video: PublicShareVideo): Promise<PublicShareCreator[]> {
  const rows = await database.prepare(`
    SELECT creator.channel_id,channel.title,COALESCE(channel.thumbnail,'') AS thumbnail,creator.handle,
           COALESCE(channel.subscriber_count,'') AS subscriber_count,creator.is_owner
    FROM video_creators creator JOIN channels channel ON channel.channel_id=creator.channel_id
    WHERE creator.video_id=? ORDER BY creator.sort_order,creator.channel_id
  `).all<PublicShareCreator>(video.video_id);
  if (rows.length > 0) return rows;
  const channel = await database.prepare(`
    SELECT channel_id,title,COALESCE(thumbnail,'') AS thumbnail,'' AS handle,
           COALESCE(subscriber_count,'') AS subscriber_count,1 AS is_owner
    FROM channels WHERE channel_id=?
  `).get<PublicShareCreator>(video.channel_id);
  return channel ? [channel] : [];
}

export function publicShareChapters(raw: string | null): Array<{ title: string; start: number }> {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.slice(0, 500).flatMap((chapter) => {
      const title = typeof chapter?.title === "string" ? chapter.title.trim().slice(0, 300) : "";
      const start = Number(chapter?.start ?? chapter?.start_time);
      return title && Number.isFinite(start) && start >= 0 ? [{ title, start }] : [];
    });
  } catch {
    return [];
  }
}

export async function listManagedPublicShares(ownerUserId: number, administrator: boolean, filter?: { resourceType?: PublicShareResourceType; resourceId?: string }): Promise<PublicShareRow[]> {
  await removeTerminatedShares();
  const where = administrator ? ["1=1"] : ["share.owner_user_id=?"];
  const params: unknown[] = administrator ? [] : [ownerUserId];
  if (filter?.resourceType) { where.push("share.resource_type=?"); params.push(filter.resourceType); }
  if (filter?.resourceId) { where.push("share.resource_id=?"); params.push(filter.resourceId); }
  const prioritizeOwner = administrator && Boolean(filter?.resourceType && filter?.resourceId);
  if (prioritizeOwner) params.push(ownerUserId);
  return database.prepare(`
    SELECT share.id,share.token,share.owner_user_id,share.resource_type,share.resource_id,
           share.allow_local_media,share.created_at,share.updated_at,owner.name AS owner_name
    FROM public_shares share JOIN users owner ON owner.id=share.owner_user_id
    WHERE ${where.join(" AND ")}
    ORDER BY ${prioritizeOwner ? "CASE WHEN share.owner_user_id=? THEN 0 ELSE 1 END," : ""} share.created_at DESC,share.id
  `).all<PublicShareRow>(...params);
}

export async function managedPublicShare(id: string): Promise<PublicShareRow | null> {
  const share = await database.prepare(`
    SELECT id,token,owner_user_id,resource_type,resource_id,allow_local_media,created_at,updated_at
    FROM public_shares WHERE id=?
  `).get<PublicShareRow>(id);
  return share && !await removeTerminatedShare(share) ? share : null;
}

export async function createPublicShare(ownerUserId: number, resourceType: PublicShareResourceType, resourceId: string): Promise<PublicShareRow> {
  if (!await publicSharingEnabled()) throw new PublicShareError(409, "public_sharing_disabled", "public sharing is disabled");
  if (!await profileCanPublishPublicShares(ownerUserId)) {
    throw new PublicShareError(403, "public_sharing_permission_denied", "profile cannot publish public shares");
  }
  if (!await publicShareResourceIsValid(ownerUserId, resourceType, resourceId)) {
    throw new PublicShareError(409, "public_share_resource_unavailable", "resource cannot be shared");
  }
  const existing = await database.prepare(`
    SELECT id,token,owner_user_id,resource_type,resource_id,allow_local_media,created_at,updated_at
    FROM public_shares WHERE owner_user_id=? AND resource_type=? AND resource_id=?
  `).get<PublicShareRow>(ownerUserId, resourceType, resourceId);
  if (existing) return existing;
  const id = crypto.randomUUID();
  const token = createPublicShareToken();
  const now = new Date().toISOString();
  return database.prepare(`
    INSERT INTO public_shares(id,token,owner_user_id,resource_type,resource_id,allow_local_media,created_at,updated_at)
    VALUES(?,?,?,?,?,0,?,?)
    RETURNING id,token,owner_user_id,resource_type,resource_id,allow_local_media,created_at,updated_at
  `).get<PublicShareRow>(id, token, ownerUserId, resourceType, resourceId, now, now) as Promise<PublicShareRow>;
}

export async function rotatePublicShare(id: string): Promise<PublicShareRow | null> {
  const token = createPublicShareToken();
  const now = new Date().toISOString();
  return database.prepare(`
    UPDATE public_shares SET token=?,updated_at=? WHERE id=?
    RETURNING id,token,owner_user_id,resource_type,resource_id,allow_local_media,created_at,updated_at
  `).get<PublicShareRow>(token, now, id);
}

export async function updatePublicShareLocalMedia(id: string, allowed: boolean): Promise<{ share: PublicShareRow | null; rotated: boolean }> {
  const current = await managedPublicShare(id);
  if (!current) return { share: null, rotated: false };
  const rotated = allowed && current.allow_local_media !== 1;
  const token = rotated ? createPublicShareToken() : current.token;
  const now = new Date().toISOString();
  const share = await database.prepare(`
    UPDATE public_shares SET allow_local_media=?,token=?,updated_at=? WHERE id=?
    RETURNING id,token,owner_user_id,resource_type,resource_id,allow_local_media,created_at,updated_at
  `).get<PublicShareRow>(allowed ? 1 : 0, token, now, id);
  return { share, rotated };
}

export async function deletePublicShare(id: string): Promise<boolean> {
  const result = await database.prepare("DELETE FROM public_shares WHERE id=?").run(id);
  return Number(result.changes ?? 0) === 1;
}

export async function publicShareStatus(share: PublicShareRow, policyEnabled: boolean): Promise<{ active: boolean; reason: string | null; resource: PublicShareResourceSummary | null }> {
  const resource = await resourceSummary(share.owner_user_id, share.resource_type, share.resource_id);
  if (!policyEnabled) return { active: false, reason: "policy_disabled", resource };
  if (!await profileCanPublishPublicShares(share.owner_user_id)) return { active: false, reason: "permission_suspended", resource };
  if (!resource) return { active: false, reason: "resource_unavailable", resource: null };
  return { active: true, reason: null, resource };
}
