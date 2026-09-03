import { database, databaseConfig } from "./database";
import {
  defaultFeedBuilderConfig,
  normalizeFeedBuilderConfig,
  type FeedBuilderConfig,
} from "../../shared/feedBuilder";

export async function getFeedBuilderConfig(userId: number): Promise<FeedBuilderConfig> {
  const row = await database.prepare(
    "SELECT revision, config_json FROM user_feed_configs WHERE user_id = ?",
  ).get<{ revision: number; config_json: string }>(userId);
  if (!row) return defaultFeedBuilderConfig();
  try {
    return normalizeFeedBuilderConfig(JSON.parse(row.config_json), row.revision);
  } catch {
    return { ...defaultFeedBuilderConfig(), revision: row.revision };
  }
}

export async function saveFeedBuilderConfig(
  userId: number,
  input: unknown,
  expectedRevision: number,
): Promise<{ config: FeedBuilderConfig; conflict: boolean }> {
  return database.transaction(async () => {
    // A missing config row cannot be protected by SELECT ... FOR UPDATE.
    // Serialize per-profile writes on PostgreSQL so two first saves cannot
    // both accept revision 0; SQLite transactions are already serialized.
    if (databaseConfig.engine === "postgres") {
      await database.prepare("SELECT pg_advisory_xact_lock(?)").get(9_870_000_000 + userId);
    }
    const current = await getFeedBuilderConfig(userId);
    if (current.revision !== expectedRevision) return { config: current, conflict: true };
    const revision = current.revision + 1;
    const config = normalizeFeedBuilderConfig(input, revision);
    await database.prepare(`
      INSERT INTO user_feed_configs(user_id, revision, config_json, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET
        revision = excluded.revision,
        config_json = excluded.config_json,
        updated_at = excluded.updated_at
    `).run(userId, revision, JSON.stringify({ ...config, revision: undefined }));
    await database.prepare("DELETE FROM feed_composition_sessions WHERE user_id = ?").run(userId);
    return { config, conflict: false };
  })();
}
