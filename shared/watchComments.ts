export const WATCH_COMMENTS_MODES = ["disabled", "scroll", "auto"] as const;

export type WatchCommentsMode = (typeof WATCH_COMMENTS_MODES)[number];
export type WatchCommentsSetting = WatchCommentsMode | "0" | "1";

/**
 * Reads both the current enum and the legacy boolean values. Existing profiles
 * that enabled comments with `1` keep the historical scroll-to-load behavior.
 */
export function normalizeWatchCommentsMode(value: unknown): WatchCommentsMode {
  if (value === "1" || value === "scroll") return "scroll";
  if (value === "auto") return "auto";
  return "disabled";
}

export function isWatchCommentsSetting(value: unknown): value is WatchCommentsSetting {
  return value === "0" || value === "1" || (typeof value === "string" && (WATCH_COMMENTS_MODES as readonly string[]).includes(value));
}
