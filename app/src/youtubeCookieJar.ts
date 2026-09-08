import { chmodSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { downloadCookiesConfigured, downloadCookiesFile } from "./downloadConfig";
import { log } from "./logger";
import { readYouTubeResponse } from "./youtubeRateLimit";
import { resolveYouTubeLanguage, youtubeRequestHeaders } from "./youtubeRequestLanguage";

const COOKIE_HEALTH_TTL_MS = 10 * 60_000;
const COOKIE_HEALTH_TIMEOUT_MS = 10_000;
const COOKIE_HEALTH_URL = "https://www.youtube.com/";

export type YouTubeCookieRecognition = "recognized" | "unrecognized" | "unknown";
export interface YouTubeCookieHealth {
  configured: boolean;
  recognition: YouTubeCookieRecognition;
  checked_at: string | null;
}

interface RecognitionEntry {
  recognition: YouTubeCookieRecognition;
  checkedAt: number;
}

interface NetscapeCookie {
  domain: string;
  includeSubdomains: boolean;
  path: string;
  secure: boolean;
  expires: number;
  name: string;
  value: string;
  httpOnly: boolean;
}

interface SetCookieUpdate extends NetscapeCookie {
  expired: boolean;
}

const recognitionByProfile = new Map<number, RecognitionEntry>();
const healthInFlight = new Map<number, Promise<YouTubeCookieHealth>>();
let temporarySequence = 0;

function isYouTubeDomain(domain: string): boolean {
  const normalized = domain.replace(/^\./, "").toLowerCase();
  return normalized === "youtube.com" || normalized.endsWith(".youtube.com");
}

function cookieKey(cookie: Pick<NetscapeCookie, "domain" | "path" | "name">): string {
  return `${cookie.domain.replace(/^\./, "").toLowerCase()}\t${cookie.path}\t${cookie.name}`;
}

function parseNetscapeCookie(line: string): NetscapeCookie | null {
  const httpOnly = line.startsWith("#HttpOnly_");
  const value = httpOnly ? line.slice("#HttpOnly_".length) : line;
  if (!value || value.startsWith("#")) return null;
  const columns = value.split("\t");
  if (columns.length < 7) return null;
  const [domain, includeSubdomains, path, secure, expires, name, ...valueParts] = columns;
  if (!domain || !path || !name) return null;
  return {
    domain,
    includeSubdomains: includeSubdomains.toUpperCase() === "TRUE",
    path,
    secure: secure.toUpperCase() === "TRUE",
    expires: Number(expires) || 0,
    name,
    value: valueParts.join("\t"),
    httpOnly,
  };
}

function defaultCookiePath(requestUrl: URL): string {
  const path = requestUrl.pathname;
  if (!path.startsWith("/") || path === "/") return "/";
  const finalSlash = path.lastIndexOf("/");
  return finalSlash <= 0 ? "/" : path.slice(0, finalSlash);
}

function parseSetCookie(value: string, requestUrl: URL, nowSeconds: number): SetCookieUpdate | null {
  const parts = value.split(";");
  const pair = parts.shift()?.trim() ?? "";
  const separator = pair.indexOf("=");
  if (separator <= 0) return null;
  const name = pair.slice(0, separator).trim();
  const cookieValue = pair.slice(separator + 1).trim();
  if (!name || /[\u0000-\u0020\u007f()<>@,;:\\"/\[\]?={}]/.test(name) || /[\r\n\t]/.test(cookieValue)) return null;

  const attributes = new Map<string, string>();
  const flags = new Set<string>();
  for (const rawAttribute of parts) {
    const attribute = rawAttribute.trim();
    if (!attribute) continue;
    const attributeSeparator = attribute.indexOf("=");
    const key = (attributeSeparator < 0 ? attribute : attribute.slice(0, attributeSeparator)).trim().toLowerCase();
    if (attributeSeparator < 0) flags.add(key);
    else attributes.set(key, attribute.slice(attributeSeparator + 1).trim());
  }

  const domainAttribute = attributes.get("domain")?.toLowerCase().replace(/^\./, "");
  const domain = domainAttribute ?? requestUrl.hostname.toLowerCase();
  if (!isYouTubeDomain(domain)) return null;
  if (domainAttribute && requestUrl.hostname.toLowerCase() !== domain && !requestUrl.hostname.toLowerCase().endsWith(`.${domain}`)) return null;
  const pathAttribute = attributes.get("path");
  const path = pathAttribute?.startsWith("/") ? pathAttribute : defaultCookiePath(requestUrl);

  let expires = 0;
  let expired = false;
  const maxAge = attributes.get("max-age");
  const maxAgeSeconds = maxAge !== undefined && /^-?\d+$/.test(maxAge) ? Number(maxAge) : null;
  if (maxAgeSeconds !== null && Number.isFinite(maxAgeSeconds)) {
    expired = maxAgeSeconds <= 0;
    expires = expired ? 1 : Math.floor(nowSeconds + maxAgeSeconds);
  } else if (attributes.has("expires")) {
    const parsed = Date.parse(attributes.get("expires") ?? "");
    if (Number.isFinite(parsed)) {
      expires = Math.floor(parsed / 1000);
      expired = expires <= nowSeconds;
    }
  }

  return {
    domain: domainAttribute ? `.${domain}` : domain,
    includeSubdomains: domainAttribute !== undefined,
    path,
    secure: flags.has("secure"),
    expires,
    name,
    value: cookieValue,
    httpOnly: flags.has("httponly"),
    expired,
  };
}

function serializeNetscapeCookie(cookie: NetscapeCookie): string {
  const prefix = cookie.httpOnly ? "#HttpOnly_" : "";
  return `${prefix}${cookie.domain}\t${cookie.includeSubdomains ? "TRUE" : "FALSE"}\t${cookie.path}\t${cookie.secure ? "TRUE" : "FALSE"}\t${cookie.expires}\t${cookie.name}\t${cookie.value}`;
}

/** Merge YouTube Set-Cookie values into a Netscape-format jar without touching
 * cookies belonging to other domains. The update count includes removals. */
export function mergeYouTubeSetCookies(
  contents: string,
  setCookies: string[],
  requestUrl: string,
  nowSeconds = Date.now() / 1000,
): { contents: string; updates: number } {
  let url: URL;
  try { url = new URL(requestUrl); } catch { return { contents, updates: 0 }; }
  if (url.protocol !== "https:" || !isYouTubeDomain(url.hostname)) return { contents, updates: 0 };

  const trailingNewline = /\r?\n$/.test(contents);
  const lines = contents.split(/\r?\n/);
  if (trailingNewline) lines.pop();
  const indices = new Map<string, number>();
  for (let index = 0; index < lines.length; index++) {
    const parsed = parseNetscapeCookie(lines[index]);
    if (parsed && isYouTubeDomain(parsed.domain)) indices.set(cookieKey(parsed), index);
  }

  let updates = 0;
  for (const header of setCookies) {
    const cookie = parseSetCookie(header, url, nowSeconds);
    if (!cookie) continue;
    const key = cookieKey(cookie);
    const index = indices.get(key);
    if (cookie.expired) {
      if (index === undefined) continue;
      lines.splice(index, 1);
      indices.clear();
      for (let next = 0; next < lines.length; next++) {
        const parsed = parseNetscapeCookie(lines[next]);
        if (parsed && isYouTubeDomain(parsed.domain)) indices.set(cookieKey(parsed), next);
      }
      updates++;
      continue;
    }

    const serialized = serializeNetscapeCookie(cookie);
    if (index === undefined) {
      indices.set(key, lines.length);
      lines.push(serialized);
      updates++;
    } else if (lines[index] !== serialized) {
      lines[index] = serialized;
      updates++;
    }
  }

  return { contents: updates > 0 ? `${lines.join("\n")}${trailingNewline ? "\n" : ""}` : contents, updates };
}

/** Apply a merge through a mode-0600 temporary file and atomic rename. */
export function refreshYouTubeCookieFile(destination: string, setCookies: string[], requestUrl: string): number {
  const current = readFileSync(destination, "utf8");
  const merged = mergeYouTubeSetCookies(current, setCookies, requestUrl);
  if (merged.updates === 0) return 0;
  const temporary = `${destination}.refresh-${process.pid}-${Date.now()}-${++temporarySequence}.tmp`;
  try {
    writeFileSync(temporary, merged.contents, { mode: 0o600, flag: "wx" });
    renameSync(temporary, destination);
    try { chmodSync(destination, 0o600); } catch { /* unsupported on some hosts */ }
  } finally {
    try { unlinkSync(temporary); } catch { /* renamed or never created */ }
  }
  return merged.updates;
}

function responseSetCookies(response: Response): string[] {
  return response.headers.getSetCookie();
}

function effectiveCookieProfile(userId?: number): number | null {
  const effectiveUserId = resolveYouTubeLanguage(userId).userId;
  return effectiveUserId && downloadCookiesConfigured(effectiveUserId) ? effectiveUserId : null;
}

/** Persist cookie rotation before the caller consumes or rejects the response. */
export function refreshYouTubeResponseCookies(response: Response, userId: number | undefined, requestUrl: string): number {
  const effectiveUserId = effectiveCookieProfile(userId);
  if (!effectiveUserId) return 0;
  const setCookies = responseSetCookies(response);
  if (setCookies.length === 0) return 0;
  const destination = downloadCookiesFile(effectiveUserId);
  try {
    const updates = refreshYouTubeCookieFile(destination, setCookies, response.url || requestUrl);
    if (updates > 0) log.info("cookies.refreshed", { userId: effectiveUserId, updates });
    return updates;
  } catch (error) {
    log.warn("cookies.refresh_failed", {
      userId: effectiveUserId,
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

/** YouTube exposes login state in several response shapes. Treat only explicit
 * positive/negative markers as an answer so an error or consent page remains unknown. */
export function detectYouTubeCookieRecognition(body: string): boolean | null {
  const positive = [
    /["']LOGGED_IN["']\s*:\s*true/,
    /["']loggedOut["']\s*:\s*false/,
    /["']key["']\s*:\s*["']logged_in["']\s*,\s*["']value["']\s*:\s*["']1["']/,
  ];
  if (positive.some((marker) => marker.test(body))) return true;
  const negative = [
    /["']LOGGED_IN["']\s*:\s*false/,
    /["']loggedOut["']\s*:\s*true/,
    /["']key["']\s*:\s*["']logged_in["']\s*,\s*["']value["']\s*:\s*["']0["']/,
  ];
  return negative.some((marker) => marker.test(body)) ? false : null;
}

function recordRecognition(userId: number | undefined, body: string, now = Date.now()): void {
  const effectiveUserId = effectiveCookieProfile(userId);
  if (!effectiveUserId) return;
  const recognized = detectYouTubeCookieRecognition(body);
  if (recognized === null) return;
  const recognition: YouTubeCookieRecognition = recognized ? "recognized" : "unrecognized";
  const previous = recognitionByProfile.get(effectiveUserId);
  recognitionByProfile.set(effectiveUserId, { recognition, checkedAt: now });
  if (previous?.recognition !== recognition) {
    log.info("cookies.recognition_changed", { userId: effectiveUserId, recognition });
  }
}

export async function readYouTubeBodyWithCookies(response: Response, userId: number | undefined, requestUrl: string): Promise<string> {
  refreshYouTubeResponseCookies(response, userId, requestUrl);
  const body = await response.text();
  recordRecognition(userId, body);
  return body;
}

export async function readYouTubeResponseWithCookies(
  response: Response,
  failure: string,
  userId: number | undefined,
  requestUrl: string,
): Promise<string> {
  refreshYouTubeResponseCookies(response, userId, requestUrl);
  return readYouTubeResponse(response, failure, (body) => recordRecognition(userId, body));
}

function healthResult(userId: number): YouTubeCookieHealth | null {
  const entry = recognitionByProfile.get(userId);
  return entry ? {
    configured: true,
    recognition: entry.recognition,
    checked_at: new Date(entry.checkedAt).toISOString(),
  } : null;
}

export function invalidateYouTubeCookieHealth(userId: number): void {
  recognitionByProfile.delete(userId);
  healthInFlight.delete(userId);
}

export async function youtubeCookieHealth(userId: number, now = Date.now()): Promise<YouTubeCookieHealth> {
  if (!downloadCookiesConfigured(userId)) {
    invalidateYouTubeCookieHealth(userId);
    return { configured: false, recognition: "unknown", checked_at: null };
  }
  const cached = recognitionByProfile.get(userId);
  if (cached && now - cached.checkedAt < COOKIE_HEALTH_TTL_MS) return healthResult(userId)!;
  const pending = healthInFlight.get(userId);
  if (pending) return pending;

  const probe = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), COOKIE_HEALTH_TIMEOUT_MS);
    try {
      const response = await fetch(COOKIE_HEALTH_URL, {
        headers: youtubeRequestHeaders(userId),
        redirect: "follow",
        signal: controller.signal,
      });
      const body = await readYouTubeBodyWithCookies(response, userId, COOKIE_HEALTH_URL);
      const recognized = detectYouTubeCookieRecognition(body);
      const recognition: YouTubeCookieRecognition = recognized === true
        ? "recognized"
        : recognized === false ? "unrecognized" : "unknown";
      recognitionByProfile.set(userId, { recognition, checkedAt: now });
      return healthResult(userId)!;
    } catch (error) {
      log.warn("cookies.health_check_failed", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      recognitionByProfile.set(userId, { recognition: "unknown", checkedAt: now });
      return healthResult(userId)!;
    } finally {
      clearTimeout(timer);
      healthInFlight.delete(userId);
    }
  })();
  healthInFlight.set(userId, probe);
  return probe;
}
