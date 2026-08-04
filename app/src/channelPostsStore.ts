import { database } from "./database";
import { fetchChannelPosts, type ChannelPost, type ChannelPostAttachment, type ChannelPostImage } from "./youtubePosts";

interface ChannelPostRow {
  post_id: string;
  author_name: string;
  author_avatar: string;
  body: string;
  published_at: string | null;
  published_text: string;
  like_count_text: string;
  reply_count_text: string;
  images_json: string;
  attachment_json: string | null;
  url: string;
}

export interface StoredChannelPosts {
  posts: ChannelPost[];
  fetchedAt: string | null;
  cached: boolean;
}

function parseImages(value: string): ChannelPostImage[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseAttachment(value: string | null): ChannelPostAttachment | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function serializePost(row: ChannelPostRow): ChannelPost {
  return {
    id: row.post_id,
    authorName: row.author_name,
    authorAvatar: row.author_avatar,
    text: row.body,
    publishedAt: row.published_at,
    publishedText: row.published_text,
    likeCount: row.like_count_text,
    replyCount: row.reply_count_text,
    images: parseImages(row.images_json),
    attachment: parseAttachment(row.attachment_json),
    url: row.url,
  };
}

export async function storedChannelPosts(channelId: string, limit = 200): Promise<StoredChannelPosts> {
  const rows = await database.prepare(`
    SELECT post_id, author_name, author_avatar, body, published_at, published_text,
           like_count_text, reply_count_text, images_json, attachment_json, url
    FROM channel_posts
    WHERE channel_id = ?
    ORDER BY COALESCE(published_at, discovered_at) DESC, source_position ASC, post_id DESC
    LIMIT ?
  `).all<ChannelPostRow>(channelId, limit);
  const state = await database.prepare(
    "SELECT last_success_at FROM channel_post_sync_state WHERE channel_id = ?",
  ).get<{ last_success_at: string | null }>(channelId);
  return { posts: rows.map(serializePost), fetchedAt: state?.last_success_at ?? null, cached: true };
}

export const persistChannelPosts = database.transaction(async (channelId: string, posts: ChannelPost[], fetchedAt: string) => {
  const upsert = database.prepare(`
    INSERT INTO channel_posts (
      post_id, channel_id, author_name, author_avatar, body, published_at, published_text,
      like_count_text, reply_count_text, images_json, attachment_json, url,
      source_position, discovered_at, last_seen_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(post_id) DO UPDATE SET
      channel_id = excluded.channel_id,
      author_name = excluded.author_name,
      author_avatar = excluded.author_avatar,
      body = excluded.body,
      published_at = COALESCE(channel_posts.published_at, excluded.published_at),
      published_text = excluded.published_text,
      like_count_text = excluded.like_count_text,
      reply_count_text = excluded.reply_count_text,
      images_json = excluded.images_json,
      attachment_json = excluded.attachment_json,
      url = excluded.url,
      source_position = excluded.source_position,
      last_seen_at = excluded.last_seen_at,
      updated_at = excluded.updated_at
  `);
  for (const [position, post] of posts.entries()) {
    await upsert.run(
      post.id, channelId, post.authorName, post.authorAvatar, post.text, post.publishedAt,
      post.publishedText, post.likeCount, post.replyCount, JSON.stringify(post.images),
      post.attachment ? JSON.stringify(post.attachment) : null, post.url, position,
      fetchedAt, fetchedAt, fetchedAt,
    );
  }
  await database.prepare(`
    INSERT INTO channel_post_sync_state (channel_id, last_attempted_at, last_success_at, last_error)
    VALUES (?, ?, ?, NULL)
    ON CONFLICT(channel_id) DO UPDATE SET
      last_attempted_at = excluded.last_attempted_at,
      last_success_at = excluded.last_success_at,
      last_error = NULL
  `).run(channelId, fetchedAt, fetchedAt);
});

async function recordFailure(channelId: string, attemptedAt: string, error: unknown): Promise<void> {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
  await database.prepare(`
    INSERT INTO channel_post_sync_state (channel_id, last_attempted_at, last_success_at, last_error)
    VALUES (?, ?, NULL, ?)
    ON CONFLICT(channel_id) DO UPDATE SET
      last_attempted_at = excluded.last_attempted_at,
      last_error = excluded.last_error
  `).run(channelId, attemptedAt, message);
}

export async function syncChannelPosts(channelId: string, language = "en"): Promise<StoredChannelPosts> {
  const attemptedAt = new Date().toISOString();
  try {
    const fetched = await fetchChannelPosts(channelId, true, language);
    await persistChannelPosts(channelId, fetched.posts, fetched.fetchedAt);
    return { posts: fetched.posts, fetchedAt: fetched.fetchedAt, cached: false };
  } catch (error) {
    await recordFailure(channelId, attemptedAt, error);
    throw error;
  }
}

export async function nextChannelPostsDue(maxAgeMinutes = 360): Promise<string | null> {
  const cutoff = new Date(Date.now() - maxAgeMinutes * 60_000).toISOString();
  const channel = await database.prepare(`
    SELECT c.channel_id
    FROM channels c
    LEFT JOIN channel_post_sync_state state ON state.channel_id = c.channel_id
    WHERE c.manual_status = 'active'
      AND (state.last_attempted_at IS NULL OR state.last_attempted_at < ?)
      AND EXISTS (
        SELECT 1
        FROM user_channels uc
        JOIN user_settings setting ON setting.user_id = uc.user_id
          AND setting.key = 'channel_posts_tab' AND setting.value = '1'
        WHERE uc.channel_id = c.channel_id AND uc.followed = 1
      )
    ORDER BY COALESCE(state.last_attempted_at, '1970-01-01T00:00:00.000Z') ASC, c.channel_id ASC
    LIMIT 1
  `).get<{ channel_id: string }>(cutoff);
  return channel?.channel_id ?? null;
}

export async function syncNextChannelPosts(maxAgeMinutes = 360): Promise<string | null> {
  const channelId = await nextChannelPostsDue(maxAgeMinutes);
  if (!channelId) return null;
  await syncChannelPosts(channelId, "en");
  return channelId;
}
