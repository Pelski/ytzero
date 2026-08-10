import { database } from "./database";

export interface UserPlaylistRule {
  id: number;
  playlist_id: number;
  pattern: string;
  match_type: "contains" | "regex";
  field: "title" | "description" | "both";
}

interface VideoForRules {
  video_id: string;
  title: string;
  description: string;
}

function ruleMatches(rule: UserPlaylistRule, title: string, description: string): boolean {
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

const insertPlaylistVideo = database.prepare(`
  INSERT OR IGNORE INTO user_playlist_videos (playlist_id, video_id, position)
  SELECT ?, ?, COALESCE(MAX(position), -1) + 1 FROM user_playlist_videos WHERE playlist_id = ?
`);

export async function applyPlaylistRulesToVideo(videoId: string): Promise<number> {
  const video = await database.prepare("SELECT video_id, title, description FROM videos WHERE video_id = ?").get(videoId) as VideoForRules | null;
  if (!video) return 0;
  const rules = await database.prepare("SELECT * FROM user_playlist_rules").all() as UserPlaylistRule[];
  let count = 0;
  for (const rule of rules) {
    if (ruleMatches(rule, video.title, video.description)) {
      await insertPlaylistVideo.run(rule.playlist_id, video.video_id, rule.playlist_id);
      count++;
    }
  }
  return count;
}

export async function applyPlaylistRulesToVideos(videoIds: string[]): Promise<void> {
  for (const videoId of videoIds) await applyPlaylistRulesToVideo(videoId);
}

export async function applyPlaylistRuleToAllVideos(ruleId: number): Promise<number> {
  const rule = await database.prepare("SELECT * FROM user_playlist_rules WHERE id = ?").get(ruleId) as UserPlaylistRule | null;
  if (!rule) return 0;
  const videos = await database.prepare("SELECT video_id, title, description FROM videos").all() as VideoForRules[];
  let count = 0;
  for (const video of videos) {
    if (ruleMatches(rule, video.title, video.description)) {
      await insertPlaylistVideo.run(rule.playlist_id, video.video_id, rule.playlist_id);
      count++;
    }
  }
  return count;
}

export async function applyPlaylistRulesForPlaylist(playlistId: number): Promise<number> {
  const rules = await database.prepare("SELECT * FROM user_playlist_rules WHERE playlist_id = ?").all(playlistId) as UserPlaylistRule[];
  const videos = await database.prepare("SELECT video_id, title, description FROM videos").all() as VideoForRules[];
  let count = 0;
  for (const video of videos) {
    if (rules.some((rule) => ruleMatches(rule, video.title, video.description))) {
      await insertPlaylistVideo.run(playlistId, video.video_id, playlistId);
      count++;
    }
  }
  return count;
}
