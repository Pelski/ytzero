import { publishAppEvent } from "./appEvents";
import { database } from "./database";
import { getSetting } from "./db";
import { isChildUser } from "./childTime";
import { createNotification } from "./notifications";
import { profileUsername, uniqueProfileUsername } from "./profileCredentials";

const LEGACY_REACTION_EMOJI: Record<string, string> = {
  like: "👍",
  love: "❤️",
  laugh: "😂",
  wow: "😮",
  sad: "😢",
  fire: "🔥",
};
const EMOJI_CONTENT = /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|[0-9#*]\uFE0F?\u20E3)/u;

const POST_BODY_LIMIT = 1_000;
const COMMENT_BODY_LIMIT = 2_000;
const POST_PAGE_LIMIT = 40;
const COMMENT_PAGE_LIMIT = 100;
const RECENT_EMOJI_LIMIT = 6;
const MENTION_PATTERN = /(^|[^\p{L}\p{N}_])@([\p{L}\p{N}_]{1,80})/gu;
export const SOCIAL_EMOJI_SKIN_TONES = ["neutral", "1f3fb", "1f3fc", "1f3fd", "1f3fe", "1f3ff"] as const;
export type SocialEmojiSkinTone = typeof SOCIAL_EMOJI_SKIN_TONES[number];

export class SocialError extends Error {
  constructor(message: string, readonly status = 400, readonly code = "social_error") {
    super(message);
  }
}

interface SocialProfileRow {
  id: number;
  name: string;
  username: string | null;
  avatar: string;
  avatar_color: string;
  is_child: number;
}

interface SocialSettings {
  commentsEnabled: boolean;
  reactionsEnabled: boolean;
  allowChildProfiles: boolean;
  notifyNewPosts: boolean;
  notifyComments: boolean;
  notifyReactions: boolean;
  notifyMentions: boolean;
}

function globalToggle(key: string, fallback: boolean): boolean {
  const raw = getSetting(`plugin_social_${key}`);
  return raw == null ? fallback : raw === "1";
}

async function userToggle(userId: number, key: string, fallback: boolean): Promise<boolean> {
  const row = await database.prepare("SELECT value FROM plugin_settings WHERE plugin_id='social' AND user_id=? AND key=?")
    .get(userId, key) as { value: string } | null;
  return row ? row.value === "1" : fallback;
}

export async function socialSettings(userId: number): Promise<SocialSettings> {
  return {
    commentsEnabled: globalToggle("comments_enabled", true),
    reactionsEnabled: globalToggle("reactions_enabled", true),
    allowChildProfiles: globalToggle("allow_child_profiles", false),
    notifyNewPosts: await userToggle(userId, "notify_new_posts", true),
    notifyComments: await userToggle(userId, "notify_comments", true),
    notifyReactions: await userToggle(userId, "notify_reactions", false),
    notifyMentions: await userToggle(userId, "notify_mentions", true),
  };
}

/** One user-selectable emoji grapheme, including flags, skin tones and ZWJ sequences. */
export function normalizeSocialReaction(value: unknown): string {
  const raw = typeof value === "string" ? value.trim().normalize("NFC") : "";
  const legacy = LEGACY_REACTION_EMOJI[raw];
  const reaction = legacy ?? raw;
  const graphemes = [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(reaction)];
  if (reaction.length > 32 || graphemes.length !== 1 || graphemes[0]?.segment !== reaction || !EMOJI_CONTENT.test(reaction)) {
    throw new SocialError("reaction must be one emoji", 400, "social_invalid_reaction");
  }
  return reaction;
}

function validStoredReaction(value: unknown): string | null {
  try { return normalizeSocialReaction(value); }
  catch { return null; }
}

export function normalizeSocialEmojiSkinTone(value: unknown): SocialEmojiSkinTone {
  if (typeof value === "string" && (SOCIAL_EMOJI_SKIN_TONES as readonly string[]).includes(value)) return value as SocialEmojiSkinTone;
  throw new SocialError("invalid emoji skin tone", 400, "social_invalid_skin_tone");
}

export async function socialEmojiSkinTone(userId: number): Promise<SocialEmojiSkinTone> {
  await assertSocialAccess(userId);
  const row = await database.prepare("SELECT value FROM plugin_state WHERE plugin_id='social' AND user_id=? AND key='emoji_skin_tone'")
    .get(userId) as { value: string } | null;
  try { return normalizeSocialEmojiSkinTone(row?.value); }
  catch { return "neutral"; }
}

export async function setSocialEmojiSkinTone(userId: number, value: unknown): Promise<SocialEmojiSkinTone> {
  await assertSocialAccess(userId);
  const skinTone = normalizeSocialEmojiSkinTone(value);
  await database.prepare(`
    INSERT INTO plugin_state(plugin_id,user_id,key,value,updated_at) VALUES('social',?,'emoji_skin_tone',?,CURRENT_TIMESTAMP)
    ON CONFLICT(plugin_id,user_id,key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at
  `).run(userId, skinTone);
  return skinTone;
}

export async function recentSocialEmojis(userId: number): Promise<string[]> {
  await assertSocialAccess(userId);
  const rows = await database.prepare("SELECT reaction_key FROM social_recent_emojis WHERE user_id=? ORDER BY used_at DESC,reaction_key LIMIT ?")
    .all(userId, RECENT_EMOJI_LIMIT) as Array<{ reaction_key: string }>;
  return rows.map((row) => validStoredReaction(row.reaction_key)).filter((emoji): emoji is string => Boolean(emoji));
}

async function rememberSocialEmoji(userId: number, reaction: string): Promise<void> {
  await database.transaction(async () => {
    const latest = await database.prepare("SELECT MAX(used_at) AS used_at FROM social_recent_emojis WHERE user_id=?").get(userId) as { used_at: number | null } | null;
    const usedAt = Math.max(Date.now(), Number(latest?.used_at ?? 0) + 1);
    await database.prepare(`
      INSERT INTO social_recent_emojis(user_id,reaction_key,used_at) VALUES(?,?,?)
      ON CONFLICT(user_id,reaction_key) DO UPDATE SET used_at=excluded.used_at
    `).run(userId, reaction, usedAt);
    await database.prepare(`
      DELETE FROM social_recent_emojis
      WHERE user_id=? AND reaction_key NOT IN (
        SELECT reaction_key FROM social_recent_emojis WHERE user_id=? ORDER BY used_at DESC,reaction_key LIMIT ?
      )
    `).run(userId, userId, RECENT_EMOJI_LIMIT);
  })();
}

async function socialEnabled(): Promise<boolean> {
  const row = await database.prepare("SELECT enabled FROM plugins WHERE id='social'").get() as { enabled: number } | null;
  return row?.enabled === 1;
}

export async function assertSocialAccess(userId: number): Promise<SocialSettings> {
  if (!await socialEnabled()) throw new SocialError("Social is disabled", 409, "social_disabled");
  const settings = await socialSettings(userId);
  if (!settings.allowChildProfiles && await isChildUser(userId)) {
    throw new SocialError("Social is not available for child profiles", 403, "social_child_restricted");
  }
  return settings;
}

function publicProfile(row: Pick<SocialProfileRow, "id" | "name" | "username" | "avatar" | "avatar_color">) {
  return {
    id: row.id,
    name: row.name,
    username: row.username || profileUsername(row.name, row.id),
    avatar: row.avatar ? `/api/profiles/${row.id}/avatar?v=${encodeURIComponent(row.avatar)}` : "",
    avatar_color: row.avatar_color,
  };
}

async function profileRows(): Promise<SocialProfileRow[]> {
  const rows = await database.prepare("SELECT id,name,username,avatar,avatar_color,is_child FROM users ORDER BY sort_order,id")
    .all() as SocialProfileRow[];
  const used = new Set(rows.flatMap((row) => row.username ? [row.username.toLowerCase()] : []));
  return rows.map((row) => row.username ? row : { ...row, username: uniqueProfileUsername(row.name, used, row.id) });
}

export async function mentionableSocialProfiles(userId: number) {
  const settings = await assertSocialAccess(userId);
  return (await profileRows())
    .filter((profile) => settings.allowChildProfiles || profile.is_child !== 1)
    .map(publicProfile);
}

function normalizeBody(value: unknown, limit: number, allowEmpty: boolean): string {
  if (typeof value !== "string") throw new SocialError("text must be a string");
  const body = value.replace(/\r\n?/g, "\n").trim();
  if (!allowEmpty && !body) throw new SocialError("text is required");
  if (body.length > limit) throw new SocialError(`text is too long (maximum ${limit} characters)`);
  return body;
}

function notificationTextExcerpt(body: string): string {
  const normalized = body.replace(/\s+/g, " ").trim();
  return normalized.length > 180 ? `${normalized.slice(0, 179).trimEnd()}…` : normalized;
}

async function resolveMentions(body: string): Promise<Array<{ userId: number; token: string }>> {
  const allowChildProfiles = globalToggle("allow_child_profiles", false);
  const profiles = (await profileRows()).filter((profile) => allowChildProfiles || profile.is_child !== 1);
  const byUsername = new Map(profiles.map((profile) => [String(profile.username).toLocaleLowerCase(), profile]));
  const mentions = new Map<number, { userId: number; token: string }>();
  for (const match of body.matchAll(MENTION_PATTERN)) {
    const profile = byUsername.get(match[2].toLocaleLowerCase());
    if (profile) mentions.set(profile.id, { userId: profile.id, token: `@${match[2]}` });
  }
  return [...mentions.values()];
}

async function replaceMentions(kind: "post" | "comment", id: string, body: string): Promise<Array<{ userId: number; token: string }>> {
  const mentions = await resolveMentions(body);
  const table = kind === "post" ? "social_post_mentions" : "social_comment_mentions";
  const idColumn = kind === "post" ? "post_id" : "comment_id";
  await database.prepare(`DELETE FROM ${table} WHERE ${idColumn}=?`).run(id);
  for (const mention of mentions) {
    await database.prepare(`INSERT INTO ${table}(${idColumn},mentioned_user_id,token) VALUES(?,?,?)`)
      .run(id, mention.userId, mention.token);
  }
  return mentions;
}

async function mentionPayload(ids: string[], kind: "post" | "comment") {
  if (ids.length === 0) return new Map<string, Array<{ profile: ReturnType<typeof publicProfile>; token: string }>>();
  const table = kind === "post" ? "social_post_mentions" : "social_comment_mentions";
  const idColumn = kind === "post" ? "post_id" : "comment_id";
  const placeholders = ids.map(() => "?").join(",");
  const rows = await database.prepare(`
    SELECT m.${idColumn} AS target_id,m.token,u.id,u.name,u.username,u.avatar,u.avatar_color
    FROM ${table} m JOIN users u ON u.id=m.mentioned_user_id
    WHERE m.${idColumn} IN (${placeholders})
  `).all(...ids) as Array<SocialProfileRow & { target_id: string; token: string }>;
  const result = new Map<string, Array<{ profile: ReturnType<typeof publicProfile>; token: string }>>();
  for (const row of rows) result.set(row.target_id, [...(result.get(row.target_id) ?? []), { profile: publicProfile(row), token: row.token }]);
  return result;
}

function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify([createdAt, id])).toString("base64url");
}

function decodeCursor(raw: string | null | undefined): [string, string] | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    return Array.isArray(value) && typeof value[0] === "string" && typeof value[1] === "string" ? [value[0], value[1]] : null;
  } catch {
    throw new SocialError("invalid cursor");
  }
}

function videoProjection(userId: number) {
  return `v.video_id,v.channel_id,v.title,v.description,v.thumbnail,v.published_at,
    v.created_at AS found_at,v.published_at_approximate,v.members_only,v.is_private,v.live_status,
    COALESCE(uv.status,'inbox') AS status,uv.bucket,uv.show_from,v.is_short,v.views,v.likes,v.duration,
    uv.liked,uv.watched,uv.watch_position,uv.watch_duration,v.external,
    EXISTS(SELECT 1 FROM history h WHERE h.video_id=v.video_id AND h.user_id=${userId}) AS in_history,
    COALESCE(c.custom_title,c.title) AS channel_title,c.thumbnail AS channel_thumbnail,
    c.subscriber_count AS channel_subscriber_count`;
}

function serializeVideo(row: Record<string, unknown>) {
  return {
    video_id: row.video_id,
    channel_id: row.channel_id,
    title: row.title,
    description: row.description,
    thumbnail: row.thumbnail,
    published_at: row.published_at,
    found_at: row.found_at,
    published_at_approximate: row.published_at_approximate,
    members_only: row.members_only,
    is_private: row.is_private,
    live_status: row.live_status,
    status: row.status,
    bucket: row.bucket,
    show_from: row.show_from,
    is_short: row.is_short,
    views: row.views,
    likes: row.likes,
    duration: row.duration,
    liked: row.liked,
    watched: row.watched,
    watch_position: row.watch_position,
    watch_duration: row.watch_duration,
    external: row.external,
    in_history: row.in_history,
    channel_title: row.channel_title,
    channel_thumbnail: row.channel_thumbnail,
    channel_subscriber_count: row.channel_subscriber_count,
    downloads_enabled: false,
    downloads_allowed: false,
    tags: [],
  };
}

async function serializePosts(userId: number, rows: Array<Record<string, any>>, isAdmin: boolean) {
  const ids = rows.map((row) => String(row.id));
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const reactionRows = await database.prepare(`SELECT post_id,reaction_key,COUNT(*) AS count FROM social_reactions WHERE post_id IN (${placeholders}) GROUP BY post_id,reaction_key`)
    .all(...ids) as Array<{ post_id: string; reaction_key: string; count: number }>;
  const reactionProfileRows = await database.prepare(`
    SELECT sr.post_id,sr.reaction_key,u.id,u.name,u.username,u.avatar,u.avatar_color
    FROM social_reactions sr
    JOIN users u ON u.id=sr.user_id
    WHERE sr.post_id IN (${placeholders})
    ORDER BY u.sort_order,u.id
  `).all(...ids) as Array<Pick<SocialProfileRow, "id" | "name" | "username" | "avatar" | "avatar_color"> & { post_id: string; reaction_key: string }>;
  const ownRows = await database.prepare(`SELECT post_id,reaction_key FROM social_reactions WHERE user_id=? AND post_id IN (${placeholders})`)
    .all(userId, ...ids) as Array<{ post_id: string; reaction_key: string }>;
  const previewRows = await database.prepare(`
    SELECT ranked.id,ranked.post_id,ranked.author_user_id,ranked.post_author_user_id,ranked.body,ranked.created_at,ranked.updated_at,
      ranked.profile_id,ranked.name,ranked.username,ranked.avatar,ranked.avatar_color,ranked.like_count,ranked.liked_by_me
    FROM (
      SELECT sc.id,sc.post_id,sc.author_user_id,sp.author_user_id AS post_author_user_id,sc.body,sc.created_at,sc.updated_at,
        u.id AS profile_id,u.name,u.username,u.avatar,u.avatar_color,
        (SELECT COUNT(*) FROM social_comment_likes scl WHERE scl.comment_id=sc.id) AS like_count,
        EXISTS(SELECT 1 FROM social_comment_likes scl WHERE scl.comment_id=sc.id AND scl.user_id=?) AS liked_by_me,
        ROW_NUMBER() OVER (PARTITION BY sc.post_id ORDER BY sc.created_at DESC,sc.id DESC) AS preview_rank
      FROM social_comments sc
      JOIN social_posts sp ON sp.id=sc.post_id
      JOIN users u ON u.id=sc.author_user_id
      WHERE sc.post_id IN (${placeholders})
    ) ranked
    WHERE ranked.preview_rank<=3
    ORDER BY ranked.post_id,ranked.created_at ASC,ranked.id ASC
  `).all(userId, ...ids) as Array<Record<string, any>>;
  const previewComments = await serializeComments(userId, previewRows, isAdmin);
  const mentions = await mentionPayload(ids, "post");
  return rows.map((row) => {
    const reactions: Record<string, number> = {};
    const reactionProfiles: Record<string, ReturnType<typeof publicProfile>[]> = {};
    for (const reaction of reactionRows) {
      if (reaction.post_id !== row.id) continue;
      const emoji = validStoredReaction(reaction.reaction_key);
      if (emoji) reactions[emoji] = (reactions[emoji] ?? 0) + Number(reaction.count);
    }
    for (const reaction of reactionProfileRows) {
      if (reaction.post_id !== row.id) continue;
      const emoji = validStoredReaction(reaction.reaction_key);
      if (!emoji) continue;
      const profiles = reactionProfiles[emoji] ?? [];
      if (!profiles.some((profile) => profile.id === reaction.id)) profiles.push(publicProfile(reaction));
      reactionProfiles[emoji] = profiles;
    }
    return {
      id: row.id,
      body: row.body,
      created_at: row.created_at,
      updated_at: row.updated_at,
      author: publicProfile({ id: row.profile_id, name: row.name, username: row.username, avatar: row.avatar, avatar_color: row.avatar_color }),
      video: serializeVideo(row),
      comments_count: Number(row.comments_count ?? 0),
      comment_preview: previewComments.filter((comment) => comment.post_id === row.id),
      reactions,
      reaction_profiles: reactionProfiles,
      my_reactions: [...new Set(ownRows.filter((reaction) => reaction.post_id === row.id).map((reaction) => validStoredReaction(reaction.reaction_key)).filter((reaction): reaction is string => Boolean(reaction)))],
      mentions: mentions.get(row.id) ?? [],
      can_edit: isAdmin || row.author_user_id === userId,
      can_delete: isAdmin || row.author_user_id === userId,
    };
  });
}

export async function listSocialPosts(userId: number, cursorRaw: string | null | undefined, requestedLimit: number, isAdmin: boolean) {
  await assertSocialAccess(userId);
  const limit = Math.min(POST_PAGE_LIMIT, Math.max(1, requestedLimit || 20));
  const cursor = decodeCursor(cursorRaw);
  const where = cursor ? "WHERE (p.created_at < ? OR (p.created_at = ? AND p.id < ?))" : "";
  const params = cursor ? [cursor[0], cursor[0], cursor[1], limit + 1] : [limit + 1];
  const rows = await database.prepare(`
    SELECT p.id,p.author_user_id,p.body,p.created_at,p.updated_at,
      u.id AS profile_id,u.name,u.username,u.avatar,u.avatar_color,
      ${videoProjection(userId)},
      (SELECT COUNT(*) FROM social_comments sc WHERE sc.post_id=p.id) AS comments_count
    FROM social_posts p
    JOIN users u ON u.id=p.author_user_id
    JOIN videos v ON v.video_id=p.video_id
    JOIN channels c ON c.channel_id=v.channel_id
    LEFT JOIN user_videos uv ON uv.video_id=v.video_id AND uv.user_id=${userId}
    ${where}
    ORDER BY p.created_at DESC,p.id DESC LIMIT ?
  `).all(...params) as Array<Record<string, any>>;
  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const posts = await serializePosts(userId, pageRows, isAdmin);
  const last = pageRows.at(-1);
  return { posts, next_cursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null };
}

export async function socialPost(userId: number, id: string, isAdmin: boolean) {
  await assertSocialAccess(userId);
  const rows = await database.prepare(`
    SELECT p.id,p.author_user_id,p.body,p.created_at,p.updated_at,
      u.id AS profile_id,u.name,u.username,u.avatar,u.avatar_color,
      ${videoProjection(userId)},
      (SELECT COUNT(*) FROM social_comments sc WHERE sc.post_id=p.id) AS comments_count
    FROM social_posts p
    JOIN users u ON u.id=p.author_user_id
    JOIN videos v ON v.video_id=p.video_id
    JOIN channels c ON c.channel_id=v.channel_id
    LEFT JOIN user_videos uv ON uv.video_id=v.video_id AND uv.user_id=${userId}
    WHERE p.id=?
  `).all(id) as Array<Record<string, any>>;
  const post = (await serializePosts(userId, rows, isAdmin))[0];
  if (!post) throw new SocialError("post not found", 404, "social_post_not_found");
  return post;
}

async function notifyMentions(actorId: number, postId: string, mentions: Array<{ userId: number; token: string }>, payload: Record<string, unknown>) {
  for (const mention of mentions) {
    if (mention.userId === actorId || !(await socialSettings(mention.userId)).notifyMentions) continue;
    await createNotification(mention.userId, "social_mention", `social_mention:${postId}:${actorId}:${mention.userId}:${String(payload.commentId ?? "post")}`, payload, `/social/${postId}`);
  }
}

async function actorPayload(userId: number) {
  const row = await database.prepare("SELECT id,name,username,avatar,avatar_color FROM users WHERE id=?").get(userId) as SocialProfileRow | null;
  if (!row) throw new SocialError("profile not found", 404);
  return publicProfile(row);
}

export async function createSocialPost(userId: number, input: { video_id?: unknown; body?: unknown }, isAdmin: boolean) {
  await assertSocialAccess(userId);
  const videoId = typeof input.video_id === "string" ? input.video_id.trim() : "";
  if (!videoId || !await database.prepare("SELECT 1 FROM videos WHERE video_id=?").get(videoId)) throw new SocialError("video not found", 404, "social_video_not_found");
  const body = normalizeBody(input.body ?? "", POST_BODY_LIMIT, true);
  const id = crypto.randomUUID();
  let mentions: Array<{ userId: number; token: string }> = [];
  await database.transaction(async () => {
    await database.prepare("INSERT INTO social_posts(id,author_user_id,video_id,body) VALUES(?,?,?,?)").run(id, userId, videoId, body);
    mentions = await replaceMentions("post", id, body);
  })();
  const actor = await actorPayload(userId);
  const video = await database.prepare("SELECT title,thumbnail FROM videos WHERE video_id=?").get(videoId) as { title: string; thumbnail: string };
  const payload = { actor, postId: id, videoId, videoTitle: video.title, thumbnail: video.thumbnail };
  await notifyMentions(userId, id, mentions, { ...payload, postBody: notificationTextExcerpt(body) });
  for (const profile of await profileRows()) {
    if (profile.id === userId || mentions.some((mention) => mention.userId === profile.id)) continue;
    if (profile.is_child === 1 && !(await socialSettings(profile.id)).allowChildProfiles) continue;
    if (!(await socialSettings(profile.id)).notifyNewPosts) continue;
    await createNotification(profile.id, "social_post", `social_post:${id}`, payload, `/social/${id}`);
  }
  publishAppEvent("social", { postId: id });
  return socialPost(userId, id, isAdmin);
}

export async function updateSocialPost(userId: number, postId: string, bodyValue: unknown, isAdmin: boolean) {
  await assertSocialAccess(userId);
  const row = await database.prepare("SELECT author_user_id FROM social_posts WHERE id=?").get(postId) as { author_user_id: number } | null;
  if (!row) throw new SocialError("post not found", 404, "social_post_not_found");
  if (!isAdmin && row.author_user_id !== userId) throw new SocialError("not allowed", 403, "social_forbidden");
  const body = normalizeBody(bodyValue ?? "", POST_BODY_LIMIT, true);
  let mentions: Array<{ userId: number; token: string }> = [];
  await database.transaction(async () => {
    await database.prepare("UPDATE social_posts SET body=?,updated_at=datetime('now') WHERE id=?").run(body, postId);
    mentions = await replaceMentions("post", postId, body);
  })();
  await notifyMentions(userId, postId, mentions, { actor: await actorPayload(userId), postId, postBody: notificationTextExcerpt(body) });
  publishAppEvent("social", { postId });
  return socialPost(userId, postId, isAdmin);
}

export async function deleteSocialPost(userId: number, postId: string, isAdmin: boolean) {
  await assertSocialAccess(userId);
  const row = await database.prepare("SELECT author_user_id FROM social_posts WHERE id=?").get(postId) as { author_user_id: number } | null;
  if (!row) throw new SocialError("post not found", 404, "social_post_not_found");
  if (!isAdmin && row.author_user_id !== userId) throw new SocialError("not allowed", 403, "social_forbidden");
  await database.prepare("DELETE FROM social_posts WHERE id=?").run(postId);
  publishAppEvent("social", { postId, deleted: true });
}

export async function setSocialReaction(userId: number, postId: string, reactionKey: string, selected: boolean, isAdmin: boolean) {
  const settings = await assertSocialAccess(userId);
  if (!settings.reactionsEnabled) throw new SocialError("reactions are disabled", 409, "social_reactions_disabled");
  const reaction = normalizeSocialReaction(reactionKey);
  const post = await database.prepare("SELECT author_user_id FROM social_posts WHERE id=?").get(postId) as { author_user_id: number } | null;
  if (!post) throw new SocialError("post not found", 404, "social_post_not_found");
  if (selected) {
    await database.prepare("INSERT OR IGNORE INTO social_reactions(post_id,user_id,reaction_key) VALUES(?,?,?)").run(postId, userId, reaction);
    await rememberSocialEmoji(userId, reaction);
  }
  else {
    const legacy = Object.entries(LEGACY_REACTION_EMOJI).find(([, emoji]) => emoji === reaction)?.[0];
    if (legacy) await database.prepare("DELETE FROM social_reactions WHERE post_id=? AND user_id=? AND reaction_key IN (?,?)").run(postId, userId, reaction, legacy);
    else await database.prepare("DELETE FROM social_reactions WHERE post_id=? AND user_id=? AND reaction_key=?").run(postId, userId, reaction);
  }
  if (selected && post.author_user_id !== userId && (await socialSettings(post.author_user_id)).notifyReactions) {
    await createNotification(post.author_user_id, "social_reaction", `social_reaction:${postId}:${userId}`, { actor: await actorPayload(userId), postId }, `/social/${postId}`);
  }
  publishAppEvent("social", { postId });
  return socialPost(userId, postId, isAdmin);
}

async function serializeComments(userId: number, rows: Array<Record<string, any>>, isAdmin: boolean) {
  const ids = rows.map((row) => String(row.id));
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  const mentions = await mentionPayload(ids, "comment");
  return rows.map((row) => ({
    id: row.id,
    post_id: row.post_id,
    body: row.body,
    created_at: row.created_at,
    updated_at: row.updated_at,
    author: publicProfile({ id: row.profile_id, name: row.name, username: row.username, avatar: row.avatar, avatar_color: row.avatar_color }),
    mentions: mentions.get(row.id) ?? [],
    like_count: Number(row.like_count ?? 0),
    liked_by_me: row.liked_by_me === 1 || row.liked_by_me === true,
    can_edit: isAdmin || row.author_user_id === userId,
    can_delete: isAdmin || row.author_user_id === userId || row.post_author_user_id === userId,
  }));
}

async function socialCommentById(userId: number, commentId: string, isAdmin: boolean) {
  const rows = await database.prepare(`
    SELECT sc.id,sc.post_id,sc.author_user_id,sp.author_user_id AS post_author_user_id,sc.body,sc.created_at,sc.updated_at,
      u.id AS profile_id,u.name,u.username,u.avatar,u.avatar_color,
      (SELECT COUNT(*) FROM social_comment_likes scl WHERE scl.comment_id=sc.id) AS like_count,
      EXISTS(SELECT 1 FROM social_comment_likes scl WHERE scl.comment_id=sc.id AND scl.user_id=?) AS liked_by_me
    FROM social_comments sc JOIN social_posts sp ON sp.id=sc.post_id JOIN users u ON u.id=sc.author_user_id
    WHERE sc.id=?
  `).all(userId, commentId) as Array<Record<string, any>>;
  return (await serializeComments(userId, rows, isAdmin))[0];
}

export async function listSocialComments(userId: number, postId: string, cursorRaw: string | null | undefined, requestedLimit: number, isAdmin: boolean) {
  const settings = await assertSocialAccess(userId);
  if (!settings.commentsEnabled) throw new SocialError("comments are disabled", 409, "social_comments_disabled");
  if (!await database.prepare("SELECT 1 FROM social_posts WHERE id=?").get(postId)) throw new SocialError("post not found", 404, "social_post_not_found");
  const limit = Math.min(COMMENT_PAGE_LIMIT, Math.max(1, requestedLimit || 40));
  const cursor = decodeCursor(cursorRaw);
  const where = cursor ? "AND (sc.created_at > ? OR (sc.created_at = ? AND sc.id > ?))" : "";
  const rows = await database.prepare(`
    SELECT sc.id,sc.post_id,sc.author_user_id,sp.author_user_id AS post_author_user_id,sc.body,sc.created_at,sc.updated_at,
      u.id AS profile_id,u.name,u.username,u.avatar,u.avatar_color,
      (SELECT COUNT(*) FROM social_comment_likes scl WHERE scl.comment_id=sc.id) AS like_count,
      EXISTS(SELECT 1 FROM social_comment_likes scl WHERE scl.comment_id=sc.id AND scl.user_id=?) AS liked_by_me
    FROM social_comments sc JOIN social_posts sp ON sp.id=sc.post_id JOIN users u ON u.id=sc.author_user_id
    WHERE sc.post_id=? ${where}
    ORDER BY sc.created_at ASC,sc.id ASC LIMIT ?
  `).all(...(cursor ? [userId, postId, cursor[0], cursor[0], cursor[1], limit + 1] : [userId, postId, limit + 1])) as Array<Record<string, any>>;
  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const last = pageRows.at(-1);
  return { comments: await serializeComments(userId, pageRows, isAdmin), next_cursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null };
}

export async function createSocialComment(userId: number, postId: string, bodyValue: unknown, isAdmin: boolean) {
  const settings = await assertSocialAccess(userId);
  if (!settings.commentsEnabled) throw new SocialError("comments are disabled", 409, "social_comments_disabled");
  const post = await database.prepare("SELECT author_user_id FROM social_posts WHERE id=?").get(postId) as { author_user_id: number } | null;
  if (!post) throw new SocialError("post not found", 404, "social_post_not_found");
  const body = normalizeBody(bodyValue, COMMENT_BODY_LIMIT, false);
  const id = crypto.randomUUID();
  let mentions: Array<{ userId: number; token: string }> = [];
  await database.transaction(async () => {
    await database.prepare("INSERT INTO social_comments(id,post_id,author_user_id,body) VALUES(?,?,?,?)").run(id, postId, userId, body);
    mentions = await replaceMentions("comment", id, body);
  })();
  const payload = { actor: await actorPayload(userId), postId, commentId: id, commentBody: notificationTextExcerpt(body) };
  await notifyMentions(userId, postId, mentions, payload);
  if (post.author_user_id !== userId && !mentions.some((mention) => mention.userId === post.author_user_id) && (await socialSettings(post.author_user_id)).notifyComments) {
    await createNotification(post.author_user_id, "social_comment", `social_comment:${id}`, payload, `/social/${postId}`);
  }
  publishAppEvent("social", { postId, commentId: id });
  return socialCommentById(userId, id, isAdmin);
}

export async function updateSocialComment(userId: number, commentId: string, bodyValue: unknown, isAdmin: boolean) {
  await assertSocialAccess(userId);
  const row = await database.prepare("SELECT post_id,author_user_id FROM social_comments WHERE id=?").get(commentId) as { post_id: string; author_user_id: number } | null;
  if (!row) throw new SocialError("comment not found", 404, "social_comment_not_found");
  if (!isAdmin && row.author_user_id !== userId) throw new SocialError("not allowed", 403, "social_forbidden");
  const body = normalizeBody(bodyValue, COMMENT_BODY_LIMIT, false);
  let mentions: Array<{ userId: number; token: string }> = [];
  await database.transaction(async () => {
    await database.prepare("UPDATE social_comments SET body=?,updated_at=datetime('now') WHERE id=?").run(body, commentId);
    mentions = await replaceMentions("comment", commentId, body);
  })();
  await notifyMentions(userId, row.post_id, mentions, { actor: await actorPayload(userId), postId: row.post_id, commentId, commentBody: notificationTextExcerpt(body) });
  publishAppEvent("social", { postId: row.post_id, commentId });
  return socialCommentById(userId, commentId, isAdmin);
}

export async function deleteSocialComment(userId: number, commentId: string, isAdmin: boolean) {
  await assertSocialAccess(userId);
  const row = await database.prepare("SELECT sc.post_id,sc.author_user_id,sp.author_user_id AS post_author_user_id FROM social_comments sc JOIN social_posts sp ON sp.id=sc.post_id WHERE sc.id=?")
    .get(commentId) as { post_id: string; author_user_id: number; post_author_user_id: number } | null;
  if (!row) throw new SocialError("comment not found", 404, "social_comment_not_found");
  if (!isAdmin && row.author_user_id !== userId && row.post_author_user_id !== userId) throw new SocialError("not allowed", 403, "social_forbidden");
  await database.prepare("DELETE FROM social_comments WHERE id=?").run(commentId);
  publishAppEvent("social", { postId: row.post_id, commentId, deleted: true });
}

export async function setSocialCommentLike(userId: number, commentId: string, liked: boolean, isAdmin: boolean) {
  const settings = await assertSocialAccess(userId);
  if (!settings.commentsEnabled) throw new SocialError("comments are disabled", 409, "social_comments_disabled");
  const comment = await database.prepare("SELECT post_id,author_user_id,body FROM social_comments WHERE id=?").get(commentId) as { post_id: string; author_user_id: number; body: string } | null;
  if (!comment) throw new SocialError("comment not found", 404, "social_comment_not_found");
  if (liked) await database.prepare("INSERT OR IGNORE INTO social_comment_likes(comment_id,user_id) VALUES(?,?)").run(commentId, userId);
  else await database.prepare("DELETE FROM social_comment_likes WHERE comment_id=? AND user_id=?").run(commentId, userId);
  if (liked && comment.author_user_id !== userId && (await socialSettings(comment.author_user_id)).notifyReactions) {
    await createNotification(comment.author_user_id, "social_comment_like", `social_comment_like:${commentId}:${userId}`, { actor: await actorPayload(userId), postId: comment.post_id, commentId, commentBody: notificationTextExcerpt(comment.body) }, `/social/${comment.post_id}`);
  }
  publishAppEvent("social", { postId: comment.post_id, commentId });
  return socialCommentById(userId, commentId, isAdmin);
}
