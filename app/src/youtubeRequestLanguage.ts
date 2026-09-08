import { readFileSync } from "node:fs";
import { downloadCookiesConfigured, downloadCookiesFile } from "./downloadConfig";
import { db, getUserSetting } from "./db";
import { isLanguage, normalizeLanguage, UI_LANGUAGES, type Language } from "../../shared/uiLanguages";

export const PROFILE_TITLE_LANGUAGE = "profile" as const;
export type YouTubeTitleLanguageSetting = typeof PROFILE_TITLE_LANGUAGE | Language;

const DEFAULT_COOKIES: Record<string, string> = {
  CONSENT: "YES+cb.20240101-00-p0.en+FX+100",
  SOCS: "CAI",
};

function primaryProfileId(): number | undefined {
  try {
    return (db.prepare("SELECT id FROM users ORDER BY id ASC LIMIT 1").get() as { id: number } | null)?.id;
  } catch {
    return undefined;
  }
}

export function normalizeYouTubeTitleLanguage(value: unknown): YouTubeTitleLanguageSetting {
  return value === PROFILE_TITLE_LANGUAGE || isLanguage(value) ? value : PROFILE_TITLE_LANGUAGE;
}

function validEnvironmentLanguage(value: string | undefined): string | null {
  const first = value?.split(",")[0]?.trim();
  return first && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(first) ? first : null;
}

export interface ResolvedYouTubeLanguage {
  /** Value used by Innertube's `hl` field. */
  hl: string;
  /** Full HTTP Accept-Language value. */
  acceptLanguage: string;
  /** Separates language- and profile-specific cookie-backed response caches. */
  cacheKey: string;
  userId?: number;
}

/** Resolve at request time so profile and setting changes never require a restart. */
export function resolveYouTubeLanguage(userId?: number): ResolvedYouTubeLanguage {
  const effectiveUserId = Number.isInteger(userId) && Number(userId) > 0 ? userId : primaryProfileId();
  const environmentLanguage = validEnvironmentLanguage(process.env.YTZERO_YT_LANGUAGE);
  if (environmentLanguage) {
    const base = environmentLanguage.split("-")[0];
    return {
      hl: environmentLanguage,
      acceptLanguage: environmentLanguage === base ? `${base};q=0.9` : `${environmentLanguage},${base};q=0.9`,
      cacheKey: `${effectiveUserId ?? "public"}:${environmentLanguage.toLowerCase()}`,
      userId: effectiveUserId,
    };
  }

  const interfaceLanguage = normalizeLanguage(effectiveUserId ? getUserSetting(effectiveUserId, "language") : undefined);
  const configured = normalizeYouTubeTitleLanguage(
    effectiveUserId ? getUserSetting(effectiveUserId, "youtube_title_language") : PROFILE_TITLE_LANGUAGE,
  );
  const language = configured === PROFILE_TITLE_LANGUAGE ? interfaceLanguage : configured;
  const definition = UI_LANGUAGES[language];
  return {
    hl: language,
    acceptLanguage: `${definition.locale},${definition.base};q=0.9`,
    cacheKey: `${effectiveUserId ?? "public"}:${language}`,
    userId: effectiveUserId,
  };
}

/** Preserve every PREF field except `hl`, which must match the current request. */
export function rewriteYouTubePrefLanguage(value: string, language: string): string {
  const fields = value.split("&").filter(Boolean);
  let replaced = false;
  const rewritten = fields.map((field) => {
    const separator = field.indexOf("=");
    const key = separator < 0 ? field : field.slice(0, separator);
    let decodedKey = key;
    try { decodedKey = decodeURIComponent(key); } catch { /* preserve malformed unrelated fields */ }
    if (decodedKey !== "hl") return field;
    replaced = true;
    return `hl=${encodeURIComponent(language)}`;
  });
  if (!replaced) rewritten.push(`hl=${encodeURIComponent(language)}`);
  return rewritten.join("&");
}

/** Convert a Netscape cookies.txt jar to a YouTube Cookie header. */
export function youtubeCookieHeaderFromNetscape(contents: string, language: string, nowSeconds = Date.now() / 1000): string {
  const cookies = new Map(Object.entries(DEFAULT_COOKIES));
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.startsWith("#HttpOnly_") ? rawLine.slice("#HttpOnly_".length) : rawLine;
    if (!line || line.startsWith("#")) continue;
    const columns = line.split("\t");
    if (columns.length < 7) continue;
    const [domain, , path, , expires, name, ...valueParts] = columns;
    if (!/(^|\.)youtube\.com$/i.test(domain.replace(/^\./, "")) || (path && !"/".startsWith(path))) continue;
    const expiry = Number(expires);
    if (Number.isFinite(expiry) && expiry > 0 && expiry <= nowSeconds) continue;
    cookies.set(name, valueParts.join("\t"));
  }
  const pref = cookies.get("PREF");
  if (pref !== undefined) cookies.set("PREF", rewriteYouTubePrefLanguage(pref, language));
  return [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
}

function profileCookieHeader(userId: number | undefined, language: string, includeProfileCookies = true): string {
  if (!includeProfileCookies || !userId || !downloadCookiesConfigured(userId)) {
    return youtubeCookieHeaderFromNetscape("", language);
  }
  try {
    return youtubeCookieHeaderFromNetscape(readFileSync(downloadCookiesFile(userId), "utf8"), language);
  } catch {
    return youtubeCookieHeaderFromNetscape("", language);
  }
}

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export function youtubeRequestHeaders(
  userId?: number,
  resolvedLanguage?: ResolvedYouTubeLanguage,
  includeProfileCookies = true,
): Record<string, string> {
  const language = resolvedLanguage ?? resolveYouTubeLanguage(userId);
  return {
    "User-Agent": USER_AGENT,
    "Accept-Language": language.acceptLanguage,
    Cookie: profileCookieHeader(language.userId, language.hl, includeProfileCookies),
  };
}

export function youtubeRssHeaders(userId?: number): Record<string, string> {
  const language = resolveYouTubeLanguage(userId);
  return { "User-Agent": USER_AGENT, "Accept-Language": language.acceptLanguage };
}
