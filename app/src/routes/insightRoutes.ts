import type { Context, Hono } from "hono";
import { database } from "../database";
import { isChildUser } from "../childTime";
import { buildHouseholdInsights, INSIGHT_RANGES } from "../insights";
import { log } from "../logger";
import { zonedDayHour } from "../timeZone";

type ApiEnvironment = { Variables: { userId: number; sessionAdmin?: boolean; profileAdmin?: boolean } };
type Api = Hono<ApiEnvironment>;
type ApiContext = Context<ApiEnvironment>;

export function registerInsightRoutes(api: Api, currentUserId: (context: ApiContext) => number): void {
// ---------- household viewing insights ----------

api.get("/insights", async (c) => {
  const uid = currentUserId(c);
  // The page compares every household profile, so keep it on the parent side
  // of the product just like child controls and the activity panel.
  if (await isChildUser(uid)) return c.json({ error: "parent profile required" }, 403);

  const requestedDays = Number(c.req.query("days") ?? 30);
  const days = INSIGHT_RANGES.includes(requestedDays as (typeof INSIGHT_RANGES)[number]) ? requestedDays : 30;
  const requestedProfile = c.req.query("profile");
  const profileId = requestedProfile && requestedProfile !== "all" ? Number(requestedProfile) : null;
  if (profileId != null && (!Number.isInteger(profileId) || profileId <= 0)) {
    return c.json({ error: "invalid profile" }, 400);
  }
  try {
    return c.json(await buildHouseholdInsights(days, profileId));
  } catch (error) {
    if (error instanceof Error && error.message === "profile not found") {
      return c.json({ error: error.message }, 404);
    }
    throw error;
  }
});

api.post("/videos/:id/sponsorblock-skip", async (c) => {
  const videoId = c.req.param("id");
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const uid = currentUserId(c);
  const category = typeof body.category === "string" ? body.category : "";
  const seconds = Number(body.skipped_seconds);
  const segmentStart = Number(body.segment_start);
  const segmentEnd = Number(body.segment_end);
  const suppliedSegmentUuid = typeof body.segment_uuid === "string" ? body.segment_uuid.trim() : "";
  const segmentUuid = suppliedSegmentUuid || `${videoId}:${category}:${segmentStart}:${segmentEnd}`;
  const suppliedEventId = typeof body.event_id === "string" ? body.event_id.trim() : "";
  const eventId = suppliedEventId || `${uid}:${videoId}:${segmentUuid}:${Date.now()}`;
  if (!category || category.length > 50 || !Number.isFinite(seconds) || seconds <= 0 || seconds > 21_600 ||
      segmentUuid.length > 240 || eventId.length > 400) {
    return c.json({ error: "invalid SponsorBlock skip" }, 400);
  }
  const result = await database.prepare(`
    INSERT OR IGNORE INTO sponsorblock_skip_log
      (event_id, user_id, video_id, segment_uuid, category, skipped_seconds, day)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(eventId, uid, videoId, segmentUuid, category, seconds, zonedDayHour().day);
  const recorded = result.changes > 0;
  if (recorded) log.info("sponsorblock.skip_recorded", { userId: uid, videoId, category, seconds });
  return c.json({ ok: true, recorded });
});

}

