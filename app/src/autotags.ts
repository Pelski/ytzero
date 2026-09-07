import { database } from "./database";

interface Rule {
  id: number;
  tag_id: number;
  pattern: string;
  match_type: "contains" | "regex";
  field: "title" | "description" | "both";
  user_id: number | null;
}

/** One auto-tag rule that matched a newly discovered video. */
export interface AutoTagMatch {
  ruleId: number;
  userId: number;
  tagId: number;
  tagName: string;
  tagColor: string;
  pattern: string;
}

function ruleMatches(rule: Rule, title: string, description: string): boolean {
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

const insertAutoTag = database.prepare(
  "INSERT OR IGNORE INTO video_tags (video_id, tag_id, source) VALUES (?, ?, 'auto')"
);

/**
 * Apply all auto-tag rules to a single video and report which rules matched, so
 * callers that discovered the video can notify each rule's owner.
 */
export async function applyAutoTags(videoId: string, title: string, description: string): Promise<AutoTagMatch[]> {
  const rules = await database.prepare(
    "SELECT r.*, t.name AS tag_name, t.color AS tag_color FROM auto_tag_rules r JOIN tags t ON t.id = r.tag_id"
  ).all() as (Rule & { tag_name: string; tag_color: string })[];
  const matched: AutoTagMatch[] = [];
  for (const rule of rules) {
    if (!ruleMatches(rule, title, description)) continue;
    await insertAutoTag.run(videoId, rule.tag_id);
    // Rules created before profiles existed have no owner and cannot be
    // attributed to an inbox, so they only tag and never notify.
    if (rule.user_id != null) {
      matched.push({ ruleId: rule.id, userId: rule.user_id, tagId: rule.tag_id, tagName: rule.tag_name, tagColor: rule.tag_color, pattern: rule.pattern });
    }
  }
  return matched;
}

/** Re-run a single rule against the whole library (used after creating/editing a rule). */
export async function applyRuleToAllVideos(ruleId: number): Promise<number> {
  const rule = await database.prepare("SELECT * FROM auto_tag_rules WHERE id = ?").get(ruleId) as Rule | null;
  if (!rule) return 0;
  const videos = await database.prepare("SELECT video_id, title, description FROM videos").all() as {
    video_id: string;
    title: string;
    description: string;
  }[];
  let count = 0;
  for (const v of videos) {
    if (ruleMatches(rule, v.title, v.description)) {
      await insertAutoTag.run(v.video_id, rule.tag_id);
      count++;
    }
  }
  return count;
}
