/** Milliseconds since a SQLite datetime('now') timestamp (stored as UTC). */
export function ageMs(timestamp: string | null): number {
  if (!timestamp) return Infinity;
  const time = Date.parse(timestamp.replace(" ", "T") + "Z");
  return Number.isFinite(time) ? Date.now() - time : Infinity;
}

export const ABOUT_DB_TTL = 7 * 24 * 60 * 60_000;
export const PLAYLISTS_DB_TTL = 7 * 24 * 60 * 60_000;
export const CHAPTERS_DB_TTL = 7 * 24 * 60 * 60_000;
export const CREATORS_DB_TTL = 7 * 24 * 60 * 60_000;
