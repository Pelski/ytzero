import { db } from "./db";

interface FilterRule {
  id: number;
  pattern: string;
  match_type: "contains" | "regex";
  field: "title" | "description" | "both";
  action: "reject" | "whitelist";
  channel_id: string | null;
  user_id: number | null;
}

function matches(rule: FilterRule, title: string, description: string): boolean {
  const haystacks: string[] = [];
  if (rule.field === "title" || rule.field === "both") haystacks.push(title);
  if (rule.field === "description" || rule.field === "both") haystacks.push(description);
  if (rule.match_type === "regex") {
    try {
      const re = new RegExp(rule.pattern, "i");
      return haystacks.some((h) => re.test(h));
    } catch {
      return false;
    }
  }
  const needle = rule.pattern.toLowerCase();
  return haystacks.some((h) => h.toLowerCase().includes(needle));
}

// Archive for one profile, but only if the video is still in their inbox.
const archiveForUser = db.prepare(
  `INSERT INTO user_videos (user_id, video_id, status) VALUES (?, ?, 'archived')
   ON CONFLICT(user_id, video_id) DO UPDATE SET status = 'archived' WHERE user_videos.status = 'inbox'`
);

/**
 * Apply every profile's filter rules to a single new video. Each rule carries
 * its owner (user_id), so rules are grouped per profile and evaluated in order;
 * the video is archived for that profile on the first reject hit (or the first
 * whitelist miss), exactly as in the single-user version — just per user.
 */
export function applyFilterRules(videoId: string, channelId: string, title: string, description: string) {
  const rules = db
    .prepare("SELECT * FROM filter_rules WHERE channel_id IS NULL OR channel_id = ?")
    .all(channelId) as FilterRule[];
  const byUser = new Map<number, FilterRule[]>();
  for (const r of rules) {
    if (r.user_id == null) continue;
    const list = byUser.get(r.user_id);
    if (list) list.push(r);
    else byUser.set(r.user_id, [r]);
  }
  for (const [userId, userRules] of byUser) {
    for (const rule of userRules) {
      const hit = matches(rule, title, description);
      if ((rule.action === "reject" && hit) || (rule.action === "whitelist" && !hit)) {
        archiveForUser.run(userId, videoId);
        break;
      }
    }
  }
}

/** Apply a single rule to all of its owner's inbox videos. Returns count archived. */
export function applyFilterRuleToAll(ruleId: number): number {
  const rule = db.prepare("SELECT * FROM filter_rules WHERE id = ?").get(ruleId) as FilterRule | null;
  if (!rule || rule.user_id == null) return 0;

  const where = rule.channel_id
    ? "COALESCE(uv.status, 'inbox') = 'inbox' AND v.channel_id = ?"
    : "COALESCE(uv.status, 'inbox') = 'inbox'";
  const args = rule.channel_id ? [rule.user_id, rule.channel_id] : [rule.user_id];
  const videos = db.prepare(
    `SELECT v.video_id, v.channel_id, v.title, v.description
     FROM videos v
     LEFT JOIN user_videos uv ON uv.video_id = v.video_id AND uv.user_id = ?
     WHERE ${where}`
  ).all(...args) as { video_id: string; channel_id: string; title: string; description: string }[];

  let count = 0;
  for (const v of videos) {
    const hit = matches(rule, v.title, v.description);
    const shouldArchive = rule.action === "reject" ? hit : !hit;
    if (shouldArchive) {
      archiveForUser.run(rule.user_id, v.video_id);
      count++;
    }
  }
  return count;
}
