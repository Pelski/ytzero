import { Archive, ArrowDownToLine, Clapperboard, Clock, HeartPulse, History, Home, ListVideo, Radio, Settings, Sparkles, ThumbsUp, type LucideIcon } from "lucide-react";
import type { I18nKey } from "./i18n";

export type NavItem = { to: string; labelKey: I18nKey; icon: LucideIcon; end?: boolean };

export const NAV_ITEMS: NavItem[] = [
  { to: "/", labelKey: "navToday", icon: Home, end: true },
  { to: "/discovery", labelKey: "navDiscovery", icon: Sparkles },
  { to: "/shorts", labelKey: "navShorts", icon: Clapperboard },
  { to: "/live", labelKey: "navLive", icon: Radio },
  { to: "/watchlist", labelKey: "navWatchlist", icon: Clock },
  { to: "/followed-playlists", labelKey: "navFollowedPlaylists", icon: ListVideo },
  { to: "/downloads", labelKey: "navDownloads", icon: ArrowDownToLine },
  { to: "/liked", labelKey: "navLiked", icon: ThumbsUp },
  { to: "/history", labelKey: "navHistory", icon: History },
  { to: "/archive", labelKey: "navArchive", icon: Archive },
  { to: "/insights", labelKey: "navInsights", icon: HeartPulse },
  { to: "/settings", labelKey: "navSettings", icon: Settings },
];

export type NavConfigEntry = { key: string; hidden: boolean };

/**
 * Parse the persisted sidebar config (JSON string) into a clean, canonicalised
 * list: known keys in saved order, unknown keys dropped, any missing items
 * appended visible at the end. Returns the default order for empty/invalid input.
 */
export function parseNavConfig(raw: string | undefined | null): NavConfigEntry[] {
  let parsed: NavConfigEntry[] = [];
  if (raw) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        parsed = arr
          .filter((e) => e && typeof e.key === "string")
          .map((e) => ({ key: e.key as string, hidden: !!e.hidden }));
      }
    } catch { /* fall back to default below */ }
  }
  const known = new Set(NAV_ITEMS.map((i) => i.to));
  const seen = new Set<string>();
  const result: NavConfigEntry[] = [];
  for (const e of parsed) {
    if (known.has(e.key) && !seen.has(e.key)) {
      seen.add(e.key);
      result.push(e);
    }
  }
  for (const i of NAV_ITEMS) {
    if (!seen.has(i.to)) result.push({ key: i.to, hidden: i.to === "/shorts" || i.to === "/insights" || i.to === "/followed-playlists" });
  }
  return result;
}

/** Stable partition: visible entries first, hidden ones pushed to the bottom. */
export function normalizeNav(entries: NavConfigEntry[]): NavConfigEntry[] {
  return [...entries.filter((e) => !e.hidden), ...entries.filter((e) => e.hidden)];
}

/** Resolve a config into the ordered visible/hidden NavItems for the sidebar. */
export function splitNavItems(config: NavConfigEntry[]): { visible: NavItem[]; hidden: NavItem[] } {
  const byKey = new Map(NAV_ITEMS.map((i) => [i.to, i] as const));
  const visible: NavItem[] = [];
  const hidden: NavItem[] = [];
  for (const e of config) {
    const item = byKey.get(e.key);
    if (!item) continue;
    (e.hidden ? hidden : visible).push(item);
  }
  return { visible, hidden };
}
