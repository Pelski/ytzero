import type { I18nKey } from "./i18n";

export type WatchedStyle =
  | "progress"
  | "dimmed"
  | "grayscale"
  | "badge_dimmed";

export const DEFAULT_WATCHED_STYLE: WatchedStyle = "dimmed";
export const WATCHED_STYLE_STORAGE_KEY = "watchedStyle";

export const WATCHED_STYLES: { id: WatchedStyle; labelKey: I18nKey }[] = [
  { id: "progress", labelKey: "watchedStyleProgress" },
  { id: "dimmed", labelKey: "watchedStyleDimmed" },
  { id: "grayscale", labelKey: "watchedStyleGrayscale" },
  { id: "badge_dimmed", labelKey: "watchedStyleBadgeDimmed" },
];

export function parseWatchedStyle(value: string | null | undefined): WatchedStyle {
  // Previous combined modes map to their thumbnail treatment now that the
  // full progress bar is an implicit part of every watched style.
  if (value === "progress_dimmed") return "dimmed";
  if (value === "progress_grayscale") return "grayscale";
  return WATCHED_STYLES.some((style) => style.id === value)
    ? value as WatchedStyle
    : DEFAULT_WATCHED_STYLE;
}

export function applyWatchedStyle(style: WatchedStyle) {
  localStorage.setItem(WATCHED_STYLE_STORAGE_KEY, style);
  document.documentElement.dataset.watchedStyle = style;
}

export function applyStoredWatchedStyle() {
  applyWatchedStyle(parseWatchedStyle(localStorage.getItem(WATCHED_STYLE_STORAGE_KEY)));
}
