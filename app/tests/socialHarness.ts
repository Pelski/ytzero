const { db } = await import("../src/db");
const { setPluginEnabled } = await import("../src/plugins");
const social = await import("../src/social");

db.prepare("UPDATE users SET username='Default' WHERE id=1").run();
const friend = db.prepare("INSERT INTO users(name,username,avatar_color,sort_order,portable_uuid) VALUES('Friend','Friend','#3366ff',1,?) RETURNING id").get(crypto.randomUUID()) as { id: number };
const child = db.prepare("INSERT INTO users(name,username,avatar_color,sort_order,portable_uuid,is_child) VALUES('Kid','Kid','#22aa66',2,?,1) RETURNING id").get(crypto.randomUUID()) as { id: number };
db.prepare("INSERT INTO channels(channel_id,title,url) VALUES('UCsocial','Social channel','https://youtube.com/channel/UCsocial')").run();
db.prepare("INSERT INTO videos(video_id,channel_id,title,thumbnail) VALUES('socialvideo1','UCsocial','Shared video','thumb.jpg')").run();
await setPluginEnabled("social", true);

const post = await social.createSocialPost(1, { video_id: "socialvideo1", body: "Obejrzyj @Friend" }, false);
db.prepare("INSERT INTO social_reactions(post_id,user_id,reaction_key) VALUES(?,?,?)").run(post.id, friend.id, "love");
const legacyVisible = (await social.socialPost(friend.id, post.id, false)).my_reactions.includes("❤️");
const legacyRemoved = !(await social.setSocialReaction(friend.id, post.id, "❤️", false, false)).my_reactions.includes("❤️");
await social.setSocialReaction(friend.id, post.id, "🤯", true, false);
const reacted = await social.setSocialReaction(friend.id, post.id, "👨‍👩‍👧‍👦", true, false);
const recentAfterAdding = await social.recentSocialEmojis(friend.id);
await social.setSocialReaction(friend.id, post.id, "👨‍👩‍👧‍👦", false, false);
const recentAfterRemoving = await social.recentSocialEmojis(friend.id);
for (const emoji of ["😀", "😁", "😂", "🤣", "😍", "🥳", "🎯"]) await social.setSocialReaction(friend.id, post.id, emoji, true, false);
const recentLimited = await social.recentSocialEmojis(friend.id);
const recentForOtherProfile = await social.recentSocialEmojis(1);
const initialSkinTone = await social.socialEmojiSkinTone(friend.id);
const savedSkinTone = await social.setSocialEmojiSkinTone(friend.id, "1f3fe");
const friendSkinTone = await social.socialEmojiSkinTone(friend.id);
const otherProfileSkinTone = await social.socialEmojiSkinTone(1);
let invalidSkinTone: unknown = null;
try { await social.setSocialEmojiSkinTone(friend.id, "blue"); }
catch (error) { invalidSkinTone = { code: (error as any).code, status: (error as any).status }; }
let invalidReaction: unknown = null;
try { await social.setSocialReaction(friend.id, post.id, "not-an-emoji", true, false); }
catch (error) { invalidReaction = { code: (error as any).code, status: (error as any).status }; }
const comment = await social.createSocialComment(friend.id, post.id, "Też polecam @Default", false);
db.prepare("INSERT INTO plugin_settings(plugin_id,user_id,key,value) VALUES('social',?,'notify_reactions','1')").run(friend.id);
const liked = await social.setSocialCommentLike(1, comment.id, true, false);
const olderPreviewComment = await social.createSocialComment(1, post.id, "Pierwszy komentarz", false);
const middlePreviewComment = await social.createSocialComment(friend.id, post.id, "Drugi komentarz", false);
const newestPreviewComment = await social.createSocialComment(1, post.id, "Najnowszy komentarz", false);
for (const [id, createdAt] of [
  [comment.id, "2026-07-31 10:00:00"],
  [olderPreviewComment.id, "2026-07-31 10:01:00"],
  [middlePreviewComment.id, "2026-07-31 10:02:00"],
  [newestPreviewComment.id, "2026-07-31 10:03:00"],
] as const) db.prepare("UPDATE social_comments SET created_at=?,updated_at=? WHERE id=?").run(createdAt, createdAt, id);
const commentPreview = (await social.socialPost(1, post.id, false)).comment_preview;
let childError: unknown = null;
try { await social.listSocialPosts(child.id, null, 20, false); }
catch (error) { childError = { code: (error as any).code, status: (error as any).status }; }
const profiles = await social.mentionableSocialProfiles(1);
const socialNotificationTargets = db.prepare("SELECT DISTINCT target FROM notifications WHERE kind LIKE 'social_%' ORDER BY target")
  .all() as Array<{ target: string }>;
const notificationQuotes = (db.prepare("SELECT kind,payload FROM notifications WHERE kind LIKE 'social_%' ORDER BY kind,id")
  .all() as Array<{ kind: string; payload: string }>)
  .map((row) => {
    const payload = JSON.parse(row.payload);
    return { kind: row.kind, source: payload.commentBody ? "comment" : "post", body: (payload.commentBody ?? payload.postBody) as string | undefined };
  })
  .filter((row): row is { kind: string; source: string; body: string } => Boolean(row.body));

console.log("RESULT " + JSON.stringify({
  friendId: friend.id,
  postId: post.id,
  postMentionIds: post.mentions.map((mention: any) => mention.profile.id),
  myReactions: reacted.my_reactions,
  reactions: { "🤯": reacted.reactions["🤯"], "👨‍👩‍👧‍👦": reacted.reactions["👨‍👩‍👧‍👦"] },
  reactionProfiles: {
    "🤯": reacted.reaction_profiles["🤯"].map((profile: { id: number }) => profile.id),
    "👨‍👩‍👧‍👦": reacted.reaction_profiles["👨‍👩‍👧‍👦"].map((profile: { id: number }) => profile.id),
  },
  recentEmojis: { afterAdding: recentAfterAdding, afterRemoving: recentAfterRemoving, limited: recentLimited, otherProfile: recentForOtherProfile },
  skinTones: { initial: initialSkinTone, saved: savedSkinTone, friend: friendSkinTone, otherProfile: otherProfileSkinTone, invalid: invalidSkinTone },
  invalidReaction,
  legacyReaction: { visible: legacyVisible, removed: legacyRemoved },
  commentMentionIds: comment.mentions.map((mention: any) => mention.profile.id),
  commentLike: { count: liked.like_count, mine: liked.liked_by_me },
  commentPreview: commentPreview.map((item: { body: string }) => item.body),
  childError,
  childMentionable: profiles.some((profile) => profile.id === child.id),
  socialNotificationTargets: socialNotificationTargets.map((row) => row.target),
  notificationQuotes,
}));
db.close();
