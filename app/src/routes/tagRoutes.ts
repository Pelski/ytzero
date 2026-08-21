import type { Context, Hono } from "hono";
import { applyRuleToAllVideos } from "../autotags";
import { database } from "../database";
import { applyFilterRuleToAll } from "../filterRules"; import { hiddenFilterTagUuids, setTagHiddenFromFilters } from "../tagFilterVisibility";

type ApiEnvironment = { Variables: { userId: number; sessionAdmin?: boolean; profileAdmin?: boolean } };
type Api = Hono<ApiEnvironment>;
type ApiContext = Context<ApiEnvironment>;

export function registerTagRoutes(
  api: Api,
  currentUserId: (context: ApiContext) => number,
): void {

// ---------- tags ----------

api.get("/tags", async (c) => {
  const uid = currentUserId(c), hiddenUuids = hiddenFilterTagUuids(uid);
  const tags = (await database
    .prepare(
      `SELECT t.*,
        (SELECT COUNT(*) FROM video_tags vt WHERE vt.tag_id = t.id) AS video_count,
        (SELECT COUNT(*) FROM channel_tags ct WHERE ct.tag_id = t.id) AS channel_count
       FROM tags t WHERE t.user_id = ? ORDER BY t.name COLLATE NOCASE`
    )
    .all(uid) as any[]).map((tag) => ({ ...tag, hidden_from_filters: hiddenUuids.has(tag.portable_uuid) ? 1 : 0 }));
  return c.json({ tags });
});

api.post("/tags", async (c) => {
  const uid = currentUserId(c);
  const { name, color } = await c.req.json();
  if (!name?.trim()) return c.json({ error: "name required" }, 400);
  const r = await database
    .prepare("INSERT INTO tags (name, color, user_id, portable_uuid) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, name) DO UPDATE SET color = excluded.color RETURNING *")
    .get(name.trim(), color ?? "#7c5cff", uid, crypto.randomUUID());
  return c.json({ tag: r });
});

api.patch("/tags/:id", async (c) => {
  const uid = currentUserId(c);
  const { name, color, filter_only, hidden_from_filters } = await c.req.json();
  const id = c.req.param("id");
  const existing = await database.prepare("SELECT portable_uuid FROM tags WHERE id = ? AND user_id = ?").get(id, uid) as { portable_uuid: string } | null; if (!existing) return c.json({ error: "not found" }, 404);
  if (name !== undefined) await database.prepare("UPDATE tags SET name = ? WHERE id = ?").run(name.trim(), id);
  if (color !== undefined) await database.prepare("UPDATE tags SET color = ? WHERE id = ?").run(color, id);
  if (filter_only !== undefined) await database.prepare("UPDATE tags SET filter_only = ? WHERE id = ?").run(filter_only ? 1 : 0, id); if (hidden_from_filters !== undefined) await setTagHiddenFromFilters(uid, existing.portable_uuid, Boolean(hidden_from_filters));
  const tag = await database.prepare("SELECT * FROM tags WHERE id = ?").get(id);
  return c.json({ tag: { ...(tag as object), hidden_from_filters: hiddenFilterTagUuids(uid).has(existing.portable_uuid) ? 1 : 0 } });
});

api.delete("/tags/:id", async (c) => {
  const uid = currentUserId(c);
  const tag = await database.prepare("SELECT portable_uuid FROM tags WHERE id = ? AND user_id = ?").get(c.req.param("id"), uid) as { portable_uuid: string } | null; await database.prepare("DELETE FROM tags WHERE id = ? AND user_id = ?").run(c.req.param("id"), uid);
  if (tag) await setTagHiddenFromFilters(uid, tag.portable_uuid, false);
  return c.json({ ok: true });
});

// ---------- auto-tag rules ----------

api.get("/rules", async (c) => {
  const uid = currentUserId(c);
  const rules = await database
    .prepare(
      `SELECT r.*, t.name AS tag_name, t.color AS tag_color FROM auto_tag_rules r JOIN tags t ON t.id = r.tag_id WHERE r.user_id = ? ORDER BY r.id`
    )
    .all(uid);
  return c.json({ rules });
});

api.post("/rules", async (c) => {
  const uid = currentUserId(c);
  const { tag_id, pattern, match_type = "contains", field = "title" } = await c.req.json();
  if (!tag_id || !pattern?.trim()) return c.json({ error: "tag_id and pattern required" }, 400);
  // The tag must belong to the active profile.
  if (!await database.prepare("SELECT 1 FROM tags WHERE id = ? AND user_id = ?").get(tag_id, uid)) return c.json({ error: "tag not found" }, 404);
  const r = await database
    .prepare("INSERT INTO auto_tag_rules (tag_id, pattern, match_type, field, user_id) VALUES (?, ?, ?, ?, ?) RETURNING *")
    .get(tag_id, pattern.trim(), match_type, field, uid) as any;
  const matched = await applyRuleToAllVideos(r.id);
  return c.json({ rule: r, matched });
});

api.patch("/rules/:id", async (c) => {
  const uid = currentUserId(c);
  const { tag_id, pattern, match_type, field } = await c.req.json();
  const id = c.req.param("id");
  if (!await database.prepare("SELECT 1 FROM auto_tag_rules WHERE id = ? AND user_id = ?").get(id, uid)) return c.json({ error: "not found" }, 404);
  if (tag_id !== undefined) {
    if (!await database.prepare("SELECT 1 FROM tags WHERE id = ? AND user_id = ?").get(tag_id, uid)) return c.json({ error: "tag not found" }, 404);
    await database.prepare("UPDATE auto_tag_rules SET tag_id = ? WHERE id = ?").run(tag_id, id);
  }
  if (pattern !== undefined) await database.prepare("UPDATE auto_tag_rules SET pattern = ? WHERE id = ?").run(pattern.trim(), id);
  if (match_type !== undefined) await database.prepare("UPDATE auto_tag_rules SET match_type = ? WHERE id = ?").run(match_type, id);
  if (field !== undefined) await database.prepare("UPDATE auto_tag_rules SET field = ? WHERE id = ?").run(field, id);
  const rule = await database.prepare("SELECT r.*, t.name AS tag_name, t.color AS tag_color FROM auto_tag_rules r JOIN tags t ON t.id = r.tag_id WHERE r.id = ?").get(id);
  return c.json({ rule });
});

api.delete("/rules/:id", async (c) => {
  const uid = currentUserId(c);
  await database.prepare("DELETE FROM auto_tag_rules WHERE id = ? AND user_id = ?").run(c.req.param("id"), uid);
  return c.json({ ok: true });
});

// ---------- filter rules ----------

api.get("/filter-rules", async (c) => {
  const uid = currentUserId(c);
  const rules = await database.prepare(
    `SELECT fr.*, COALESCE(c.custom_title, c.title) AS channel_title FROM filter_rules fr
     LEFT JOIN channels c ON c.channel_id = fr.channel_id WHERE fr.user_id = ? ORDER BY fr.id`
  ).all(uid);
  return c.json({ rules });
});

api.post("/filter-rules", async (c) => {
  const uid = currentUserId(c);
  const { pattern, match_type = "contains", field = "title", action = "reject", channel_id = null } = await c.req.json();
  if (!pattern?.trim()) return c.json({ error: "pattern required" }, 400);
  const row = await database
    .prepare("INSERT INTO filter_rules (pattern, match_type, field, action, channel_id, user_id) VALUES (?, ?, ?, ?, ?, ?) RETURNING *")
    .get(pattern.trim(), match_type, field, action, channel_id || null, uid) as any;
  const archived = await applyFilterRuleToAll(row.id);
  return c.json({ rule: row, archived });
});

api.patch("/filter-rules/:id", async (c) => {
  const uid = currentUserId(c);
  const { pattern, match_type, field, action, channel_id } = await c.req.json();
  const id = c.req.param("id");
  if (!await database.prepare("SELECT 1 FROM filter_rules WHERE id = ? AND user_id = ?").get(id, uid)) return c.json({ error: "not found" }, 404);
  if (pattern !== undefined) await database.prepare("UPDATE filter_rules SET pattern = ? WHERE id = ?").run(pattern.trim(), id);
  if (match_type !== undefined) await database.prepare("UPDATE filter_rules SET match_type = ? WHERE id = ?").run(match_type, id);
  if (field !== undefined) await database.prepare("UPDATE filter_rules SET field = ? WHERE id = ?").run(field, id);
  if (action !== undefined) await database.prepare("UPDATE filter_rules SET action = ? WHERE id = ?").run(action, id);
  if (channel_id !== undefined) await database.prepare("UPDATE filter_rules SET channel_id = ? WHERE id = ?").run(channel_id || null, id);
  const rule = await database.prepare("SELECT fr.*, COALESCE(c.custom_title, c.title) AS channel_title FROM filter_rules fr LEFT JOIN channels c ON c.channel_id = fr.channel_id WHERE fr.id = ?").get(id);
  return c.json({ rule });
});

api.delete("/filter-rules/:id", async (c) => {
  const uid = currentUserId(c);
  await database.prepare("DELETE FROM filter_rules WHERE id = ? AND user_id = ?").run(c.req.param("id"), uid);
  return c.json({ ok: true });
});

}
