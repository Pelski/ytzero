import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type React from "react";
import { api, type AppSettings, type Bucket } from "../api";
import { en } from "./locales/en";
import { pl } from "./locales/pl";
import { de } from "./locales/de";
import type { I18nKey, Language, Locale } from "./types";

export type { Language, I18nKey, Bucket } from "./types";

const LANGUAGE_KEY = "language";

/** All registered locales. Add a language: drop a file in ./locales and wire it here + in LOCALE_TAGS. */
const locales: Record<Language, Locale> = { en, pl, de };

/** BCP 47 tags used for Intl date/number formatting. Single source of truth. */
export const LOCALE_TAGS: Record<Language, string> = {
  en: "en-US",
  pl: "pl-PL",
  de: "de-DE",
};

export type SettingsWithLanguage = AppSettings & { language: Language };

/** Native (endonym) name of a language, e.g. "Deutsch", "polski" — for the language picker. */
export function languageName(code: Language): string {
  return new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code;
}

/** All available UI languages, sorted by their native name. Drives the language picker. */
export const LANGUAGES = (Object.keys(locales) as Language[]).sort((a, b) => languageName(a).localeCompare(languageName(b)));

export function normalizeLanguage(value: unknown): Language {
  return typeof value === "string" && value in locales ? (value as Language) : "en";
}

type TParams = Record<string, string | number>;

function interpolate(template: string, params?: TParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) => (key in params ? String(params[key]) : match));
}

/** Playlist-icon label for the current language, falling back to the id split into words. */
function resolveIconLabel(language: Language, id: string): string {
  return locales[language].iconLabels[id] ?? id.replace(/([a-z])([A-Z])/g, "$1 $2");
}

type I18nValue = {
  language: Language;
  setLanguage: (language: Language) => Promise<void>;
  t: (key: I18nKey, params?: TParams) => string;
  bucketLabel: (bucket: Bucket) => string;
  iconLabel: (id: string) => string;
  locale: string;
};

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => normalizeLanguage(localStorage.getItem(LANGUAGE_KEY)));

  useEffect(() => {
    api
      .settings()
      .then((r) => {
        const next = normalizeLanguage(r.settings.language);
        setLanguageState(next);
        localStorage.setItem(LANGUAGE_KEY, next);
        document.documentElement.lang = next;
      })
      .catch(() => {
        document.documentElement.lang = language;
      });
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const setLanguage = useCallback(async (next: Language) => {
    setLanguageState(next);
    localStorage.setItem(LANGUAGE_KEY, next);
    await api.updateSettings({ language: next });
  }, []);

  const value = useMemo<I18nValue>(() => ({
    language,
    setLanguage,
    t: (key, params) => interpolate(locales[language].messages[key], params),
    bucketLabel: (bucket) => locales[language].buckets[bucket],
    iconLabel: (id) => resolveIconLabel(language, id),
    locale: LOCALE_TAGS[language],
  }), [language, setLanguage]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}

// --- Locale-aware formatters ---
// Word-level differences (pluralized nouns) come from each locale's `format`
// section; everything else is handled generically by the Intl APIs below, so no
// new language needs to touch this file.

export function formatVideoCount(n: number, language: Language): string {
  return locales[language].format.videoCount(n);
}

/** Normalize YouTube's localized/raw playlist counts (for example
 * "7 videos" or "1.2K videos") before applying the app's own plural rules. */
export function formatPlaylistVideoCount(value: string | number, language: Language): string {
  if (typeof value === "number") return formatVideoCount(value, language);
  const compact = value.trim().toUpperCase().match(/([\d.,]+)\s*([KMB])/);
  const factor = compact?.[2] === "K" ? 1_000 : compact?.[2] === "M" ? 1_000_000 : compact?.[2] === "B" ? 1_000_000_000 : 1;
  const count = compact
    ? Math.round(Number(compact[1].replace(",", ".")) * factor)
    : Number(value.replace(/\D/g, ""));
  return count ? formatVideoCount(count, language) : value;
}

export function formatAddedVideos(n: number, language: Language): string {
  return locales[language].format.addedVideos(n);
}

export function formatChannelCount(n: number, language: Language): string {
  return locales[language].format.channelCount(n);
}

export function formatPlaylistCount(n: number, language: Language): string {
  return locales[language].format.playlistCount(n);
}

export function formatHistoryEntryCount(n: number, language: Language): string {
  return locales[language].format.historyEntryCount(n);
}

export function compactNumber(value: number | null, language: Language): string {
  if (value == null) return "";
  return new Intl.NumberFormat(LOCALE_TAGS[language], { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function formatViewsCount(views: number | null, language: Language): string {
  if (views == null) return "";
  return `${compactNumber(views, language)} ${locales[language].messages.views}`;
}

export function formatTimeAgo(iso: string | null, language: Language): string {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60_000);
  const h = Math.floor(min / 60);
  const d = Math.floor(h / 24);
  const mo = Math.floor(d / 30);
  const y = Math.floor(d / 365);

  const [value, unit]: [number, Intl.RelativeTimeFormatUnit] =
    min < 60 ? [min, "minute"]
    : h < 24 ? [h, "hour"]
    : d < 30 ? [d, "day"]
    : mo < 12 ? [mo, "month"]
    : [y, "year"];

  return new Intl.RelativeTimeFormat(LOCALE_TAGS[language], { numeric: "always", style: "short" }).format(-value, unit);
}

/** Format a pre-parsed "time ago" pair (e.g. from YouTube search results) in the UI language. */
export function formatPublishedAgo(published: { value: number; unit: Intl.RelativeTimeFormatUnit } | null, language: Language): string {
  if (!published) return "";
  return new Intl.RelativeTimeFormat(LOCALE_TAGS[language], { numeric: "always", style: "short" }).format(-published.value, published.unit);
}
