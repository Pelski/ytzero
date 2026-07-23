import type { Bucket } from "../api";
import { en } from "./locales/en";

export type Language = "en" | "pl" | "de";

export type I18nKey = keyof typeof en.messages;

export type Messages = Record<I18nKey, string>;

/**
 * Locale-specific formatting that can't be expressed as plain strings or handled
 * by Intl — i.e. noun pluralization. Relative time and compact numbers are done
 * with Intl in index.tsx, so they don't appear here.
 */
export type LocaleFormat = {
  /** e.g. "5 films" / "5 filmów" */
  videoCount: (n: number) => string;
  /** e.g. "Added 5 new videos" / "Dodano 5 nowych filmów" */
  addedVideos: (n: number) => string;
  /** e.g. "5 channels" / "5 kanałów" */
  channelCount: (n: number) => string;
  /** e.g. "5 playlists" / "5 playlist" */
  playlistCount: (n: number) => string;
  /** e.g. "5 entries" / "5 wpisów" (watch-history entries) */
  historyEntryCount: (n: number) => string;
};

export type Locale = {
  messages: Messages;
  buckets: Record<Bucket, string>;
  /** Curated playlist-icon labels keyed by icon id. May omit ids to fall back to the id-derived label. */
  iconLabels: Record<string, string>;
  format: LocaleFormat;
};

export type { Bucket };
