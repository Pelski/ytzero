export const VIDEO_CARD_SWIPE_DEVICES = ["desktop", "tablet", "mobile"] as const;
export type VideoCardSwipeDevice = (typeof VIDEO_CARD_SWIPE_DEVICES)[number];
export type VideoCardSwipeConfig = { version: 1; devices: VideoCardSwipeDevice[] };
export const DEFAULT_VIDEO_CARD_SWIPE_CONFIG: VideoCardSwipeConfig = { version: 1, devices: [...VIDEO_CARD_SWIPE_DEVICES] };

export function parseVideoCardSwipeConfig(value: unknown): VideoCardSwipeConfig {
  if (typeof value === "string") {
    try { return parseVideoCardSwipeConfig(JSON.parse(value)); } catch { return structuredClone(DEFAULT_VIDEO_CARD_SWIPE_CONFIG); }
  }
  if (!value || typeof value !== "object") return structuredClone(DEFAULT_VIDEO_CARD_SWIPE_CONFIG);
  const config = value as { version?: unknown; devices?: unknown };
  if (config.version !== 1 || !Array.isArray(config.devices)) return structuredClone(DEFAULT_VIDEO_CARD_SWIPE_CONFIG);
  const devices = config.devices;
  if (devices.some((device) => typeof device !== "string" || !(VIDEO_CARD_SWIPE_DEVICES as readonly string[]).includes(device)) || new Set(devices).size !== devices.length) return structuredClone(DEFAULT_VIDEO_CARD_SWIPE_CONFIG);
  return { version: 1, devices: VIDEO_CARD_SWIPE_DEVICES.filter((device) => devices.includes(device)) };
}

export function serializeVideoCardSwipeConfig(value: unknown): string { return JSON.stringify(parseVideoCardSwipeConfig(value)); }
