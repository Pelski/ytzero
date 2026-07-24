// Pure query-building for the "clean up the feed" view. No `db` import here on
// purpose — see cleanup.ts for the db-backed apply/undo pieces and
// feedQuery.ts for how this combines with feed visibility.
import { tagFilterSql } from "./feedQueryFragments";

export interface CleanupChannelFilter {
  mode: "include" | "exclude";
  ids: string[];
}

export interface CleanupTagFilter {
  include: number[];
  exclude: number[];
}

export interface CleanupFilter {
  /** inbox | queued | all — defaults to "inbox", matching how the feed itself defaults. */
  status?: string;
  /** ISO timestamp; matches videos published strictly before this instant. */
  before?: string | null;
  channels?: CleanupChannelFilter | null;
  tags?: CleanupTagFilter | null;
  /** Also match videos the feed itself would hide (shorts, live, members-only, filter rules). */
  include_hidden?: boolean;
}

/** WHERE fragment for the user's explicit cleanup choices (date/channels/tags),
 *  independent of feed visibility. */
export function cleanupSelectionWhere(filter: CleanupFilter, uid: number): { where: string[]; params: any[] } {
  const where: string[] = [];
  const params: any[] = [];
  if (filter.before) {
    where.push("v.published_at < ?");
    params.push(filter.before);
  }
  if (filter.channels && filter.channels.ids.length > 0) {
    const ph = filter.channels.ids.map(() => "?").join(",");
    where.push(`v.channel_id ${filter.channels.mode === "exclude" ? "NOT IN" : "IN"} (${ph})`);
    params.push(...filter.channels.ids);
  }
  if (filter.tags?.include.length) {
    const f = tagFilterSql(uid, filter.tags.include);
    where.push(f.sql);
    params.push(...f.params);
  }
  if (filter.tags?.exclude.length) {
    const f = tagFilterSql(uid, filter.tags.exclude);
    where.push(`NOT ${f.sql}`);
    params.push(...f.params);
  }
  return { where, params };
}
