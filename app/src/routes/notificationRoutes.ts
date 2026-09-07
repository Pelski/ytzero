import type { Context, Hono } from "hono";
import { database } from "../database";
import { NOTIFICATION_CATEGORIES, NOTIFICATION_SOURCE_TYPES, notificationPreferenceSnapshot, setNotificationPreference, sourceKind, type NotificationSourceType } from "../notificationPreferences";
import { notificationDeliverySnapshot, sendTestNotification, setNotificationDelivery } from "../notificationDelivery";

type ApiEnvironment = { Variables: { userId: number; sessionAdmin?: boolean; profileAdmin?: boolean } };
type Api = Hono<ApiEnvironment>;
type ApiContext = Context<ApiEnvironment>;

export function registerNotificationRoutes(
  api: Api,
  access: { currentUserId: (context: ApiContext) => number; isAdmin: (context: ApiContext) => boolean },
): void {
  const { currentUserId, isAdmin } = access;
  api.get("/notification-preferences", async (c) => {
    const uid = currentUserId(c);
    const [preferences, channels, playlists, rules, delivery] = await Promise.all([
      notificationPreferenceSnapshot(uid),
      database.prepare(`
        SELECT c.channel_id, COALESCE(NULLIF(c.custom_title, ''), c.title) AS title, c.thumbnail,
               np.enabled AS notification_enabled
        FROM user_channels uc
        JOIN channels c ON c.channel_id=uc.channel_id
        LEFT JOIN notification_preferences np
          ON np.user_id=uc.user_id AND np.kind='channel_video' AND np.source_id=uc.channel_id
        WHERE uc.user_id=? AND uc.followed=1
        ORDER BY title COLLATE NOCASE
      `).all(uid),
      database.prepare(`
        SELECT cp.playlist_id, cp.title, cp.thumbnail,
               COALESCE(NULLIF(c.custom_title, ''), c.title) AS channel_title,
               np.enabled AS notification_enabled
        FROM user_followed_playlists fp
        JOIN channel_playlists cp ON cp.playlist_id=fp.playlist_id
        JOIN channels c ON c.channel_id=cp.channel_id
        LEFT JOIN notification_preferences np
          ON np.user_id=fp.user_id AND np.kind='playlist_video' AND np.source_id=fp.playlist_id
        WHERE fp.user_id=?
        ORDER BY channel_title COLLATE NOCASE, cp.title COLLATE NOCASE
      `).all(uid),
      // Auto-tag rules are the profile's own automation, so `source_id` holds the
      // local rule id. It is compared as text because preferences are keyed by
      // TEXT source ids shared with channels and playlists.
      database.prepare(`
        SELECT r.id AS rule_id, r.pattern, r.match_type, r.field,
               t.name AS tag_name, t.color AS tag_color,
               np.enabled AS notification_enabled
        FROM auto_tag_rules r
        JOIN tags t ON t.id=r.tag_id
        LEFT JOIN notification_preferences np
          ON np.user_id=r.user_id AND np.kind='tag_rule' AND np.source_id=CAST(r.id AS TEXT)
        WHERE r.user_id=?
        ORDER BY t.name COLLATE NOCASE, r.id
      `).all(uid),
      notificationDeliverySnapshot(uid, isAdmin(c)),
    ]);
    return c.json({ ...preferences, channels, playlists, rules, delivery });
  });

  api.put("/notification-preferences", async (c) => {
    const uid = currentUserId(c);
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return c.json({ error: "invalid notification preferences" }, 400);
    if ("enabled" in body && typeof body.enabled !== "boolean") return c.json({ error: "enabled must be boolean" }, 400);
    if ("categories" in body && (!body.categories || typeof body.categories !== "object" || Array.isArray(body.categories))) return c.json({ error: "categories must be an object" }, 400);
    const categories = body.categories ?? {};
    if (Object.entries(categories).some(([kind, enabled]) => !NOTIFICATION_CATEGORIES.includes(kind as any) || typeof enabled !== "boolean")) return c.json({ error: "invalid notification category" }, 400);
    if ("enabled" in body) await setNotificationPreference(uid, "*", "", body.enabled);
    for (const [kind, enabled] of Object.entries(categories)) await setNotificationPreference(uid, kind, "", enabled as boolean);
    return c.json(await notificationPreferenceSnapshot(uid));
  });

  api.put("/notification-preferences/sources/:type/:id", async (c) => {
    const uid = currentUserId(c);
    const sourceType = c.req.param("type") as NotificationSourceType;
    const sourceId = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    if (!NOTIFICATION_SOURCE_TYPES.includes(sourceType) || !body || !(body.enabled === null || typeof body.enabled === "boolean")) return c.json({ error: "invalid notification source preference" }, 400);
    const belongs = sourceType === "channel"
      ? await database.prepare("SELECT 1 FROM user_channels WHERE user_id=? AND channel_id=? AND followed=1").get(uid, sourceId)
      : sourceType === "playlist"
      ? await database.prepare("SELECT 1 FROM user_followed_playlists WHERE user_id=? AND playlist_id=?").get(uid, sourceId)
      : /^\d+$/.test(sourceId)
        ? await database.prepare("SELECT 1 FROM auto_tag_rules WHERE user_id=? AND id=?").get(uid, Number(sourceId))
        : null;
    if (!belongs) return c.json({ error: "notification source not found" }, 404);
    await setNotificationPreference(uid, sourceKind(sourceType), sourceId, body.enabled);
    return c.json({ ok: true });
  });

  // ---------- external delivery (per profile) ----------

  api.get("/notification-preferences/delivery", async (c) => c.json(await notificationDeliverySnapshot(currentUserId(c), isAdmin(c))));

  api.put("/notification-preferences/delivery", async (c) => {
    const uid = currentUserId(c);
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return c.json({ error: "invalid delivery settings" }, 400);
    if ("enabled" in body && typeof body.enabled !== "boolean") return c.json({ error: "enabled must be boolean" }, 400);
    if ("targets" in body && typeof body.targets !== "string") return c.json({ error: "targets must be a string" }, 400);
    for (const key of ["appriseServerUrl", "ntfyServerUrl", "publicBaseUrl"]) {
      if (key in body && typeof body[key] !== "string") return c.json({ error: `${key} must be a string` }, 400);
    }
    try {
      return c.json(await setNotificationDelivery(uid, {
        enabled: body.enabled,
        targets: body.targets,
        appriseServerUrl: body.appriseServerUrl,
        ntfyServerUrl: body.ntfyServerUrl,
        publicBaseUrl: body.publicBaseUrl,
      }, isAdmin(c)));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, message === "administrator setting" ? 403 : 400);
    }
  });

  api.post("/notification-preferences/delivery/test", async (c) => {
    try {
      await sendTestNotification(currentUserId(c));
      return c.json({ ok: true });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });
}
