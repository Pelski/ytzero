import type { Context, Hono } from "hono";
import {
  createSocialComment,
  createSocialPost,
  deleteSocialComment,
  deleteSocialPost,
  listSocialComments,
  listSocialPosts,
  mentionableSocialProfiles,
  recentSocialEmojis,
  setSocialCommentLike,
  setSocialEmojiSkinTone,
  setSocialReaction,
  SocialError,
  socialEmojiSkinTone,
  socialPost,
  updateSocialComment,
  updateSocialPost,
} from "../social";

type ApiEnvironment = { Variables: { userId: number; sessionAdmin?: boolean; profileAdmin?: boolean } };
type Api = Hono<ApiEnvironment>;
type ApiContext = Context<ApiEnvironment>;

export function registerSocialRoutes(
  api: Api,
  access: {
    isAdmin: (context: ApiContext) => boolean;
    currentUserId: (context: ApiContext) => number;
  },
): void {
  const { isAdmin, currentUserId } = access;

function socialFailure(c: any, error: unknown) {
  if (error instanceof SocialError) return c.json({ error: error.message, code: error.code }, error.status);
  throw error;
}

api.get("/social/mentionable-profiles", async (c) => {
  try {
    return c.json({ profiles: await mentionableSocialProfiles(currentUserId(c)) });
  } catch (error) {
    return socialFailure(c, error);
  }
});

api.get("/social/reactions/recent", async (c) => {
  try {
    const userId = currentUserId(c);
    const [emojis, skinTone] = await Promise.all([recentSocialEmojis(userId), socialEmojiSkinTone(userId)]);
    return c.json({ emojis, skinTone });
  } catch (error) {
    return socialFailure(c, error);
  }
});

api.put("/social/reactions/skin-tone", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    return c.json({ skinTone: await setSocialEmojiSkinTone(currentUserId(c), body.skinTone) });
  } catch (error) {
    return socialFailure(c, error);
  }
});

api.get("/social/posts", async (c) => {
  try {
    return c.json(await listSocialPosts(
      currentUserId(c),
      c.req.query("cursor"),
      Number(c.req.query("limit") ?? 20),
      isAdmin(c),
    ));
  } catch (error) {
    return socialFailure(c, error);
  }
});

api.get("/social/posts/:id", async (c) => {
  try {
    return c.json({ post: await socialPost(currentUserId(c), c.req.param("id"), isAdmin(c)) });
  } catch (error) {
    return socialFailure(c, error);
  }
});

api.post("/social/posts", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    return c.json({ post: await createSocialPost(currentUserId(c), body, isAdmin(c)) }, 201);
  } catch (error) {
    return socialFailure(c, error);
  }
});

api.patch("/social/posts/:id", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    return c.json({ post: await updateSocialPost(currentUserId(c), c.req.param("id"), body.body, isAdmin(c)) });
  } catch (error) {
    return socialFailure(c, error);
  }
});

api.delete("/social/posts/:id", async (c) => {
  try {
    await deleteSocialPost(currentUserId(c), c.req.param("id"), isAdmin(c));
    return c.json({ ok: true });
  } catch (error) {
    return socialFailure(c, error);
  }
});

api.put("/social/posts/:id/reactions/:reaction", async (c) => {
  try {
    return c.json({ post: await setSocialReaction(currentUserId(c), c.req.param("id"), c.req.param("reaction"), true, isAdmin(c)) });
  } catch (error) {
    return socialFailure(c, error);
  }
});

api.delete("/social/posts/:id/reactions/:reaction", async (c) => {
  try {
    return c.json({ post: await setSocialReaction(currentUserId(c), c.req.param("id"), c.req.param("reaction"), false, isAdmin(c)) });
  } catch (error) {
    return socialFailure(c, error);
  }
});

api.get("/social/posts/:id/comments", async (c) => {
  try {
    return c.json(await listSocialComments(
      currentUserId(c),
      c.req.param("id"),
      c.req.query("cursor"),
      Number(c.req.query("limit") ?? 40),
      isAdmin(c),
    ));
  } catch (error) {
    return socialFailure(c, error);
  }
});

api.post("/social/posts/:id/comments", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    return c.json({ comment: await createSocialComment(currentUserId(c), c.req.param("id"), body.body, isAdmin(c)) }, 201);
  } catch (error) {
    return socialFailure(c, error);
  }
});

api.patch("/social/comments/:id", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    return c.json({ comment: await updateSocialComment(currentUserId(c), c.req.param("id"), body.body, isAdmin(c)) });
  } catch (error) {
    return socialFailure(c, error);
  }
});

api.delete("/social/comments/:id", async (c) => {
  try {
    await deleteSocialComment(currentUserId(c), c.req.param("id"), isAdmin(c));
    return c.json({ ok: true });
  } catch (error) {
    return socialFailure(c, error);
  }
});

api.put("/social/comments/:id/like", async (c) => {
  try {
    return c.json({ comment: await setSocialCommentLike(currentUserId(c), c.req.param("id"), true, isAdmin(c)) });
  } catch (error) {
    return socialFailure(c, error);
  }
});

api.delete("/social/comments/:id/like", async (c) => {
  try {
    return c.json({ comment: await setSocialCommentLike(currentUserId(c), c.req.param("id"), false, isAdmin(c)) });
  } catch (error) {
    return socialFailure(c, error);
  }
});
}

