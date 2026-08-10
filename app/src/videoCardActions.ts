export const VIDEO_CARD_ACTION_MODES = ["hover", "always", "bar_always", "on_demand", "delay", "off"] as const;
export type VideoCardActionMode = (typeof VIDEO_CARD_ACTION_MODES)[number];
export const VIDEO_CARD_PREVIEW_MODES = ["off", "downloaded", "all"] as const;
export type VideoCardPreviewMode = (typeof VIDEO_CARD_PREVIEW_MODES)[number];

export function isVideoCardPreviewMode(value: unknown): value is VideoCardPreviewMode {
  return typeof value === "string" && (VIDEO_CARD_PREVIEW_MODES as readonly string[]).includes(value);
}

export function isVideoCardActionMode(value: unknown): value is VideoCardActionMode {
  return typeof value === "string" && (VIDEO_CARD_ACTION_MODES as readonly string[]).includes(value);
}

export function normalizeVideoCardActionMode(value: unknown): VideoCardActionMode {
  return isVideoCardActionMode(value) ? value : "hover";
}

export const VIDEO_CARD_ACTION_IDS = ["schedule", "playlist", "download", "archive", "watched", "restore", "remove"] as const;
export type VideoCardActionId = (typeof VIDEO_CARD_ACTION_IDS)[number];
export type VideoCardActionConfig = { version: 1; actions: Array<{ id: VideoCardActionId; hidden: boolean }> };
export const LOCKED_VIDEO_CARD_ACTION_IDS = new Set<VideoCardActionId>(["schedule", "restore", "remove"]);

export const DEFAULT_VIDEO_CARD_ACTION_CONFIG: VideoCardActionConfig = {
  version: 1,
  actions: VIDEO_CARD_ACTION_IDS.map((id) => ({ id, hidden: id === "playlist" || id === "download" })),
};

export function parseVideoCardActionConfig(value: unknown): VideoCardActionConfig | null {
  if (typeof value === "string") {
    try { return parseVideoCardActionConfig(JSON.parse(value)); } catch { return null; }
  }
  if (!value || typeof value !== "object") return null;
  const config = value as { version?: unknown; actions?: unknown };
  if (config.version !== 1 || !Array.isArray(config.actions)) return null;
  const seen = new Set<string>();
  const actions: VideoCardActionConfig["actions"] = [];
  for (const entry of config.actions) {
    if (!entry || typeof entry !== "object") return null;
    const { id, hidden } = entry as { id?: unknown; hidden?: unknown };
    if (typeof id !== "string" || !(VIDEO_CARD_ACTION_IDS as readonly string[]).includes(id) || typeof hidden !== "boolean" || seen.has(id)) return null;
    seen.add(id);
    actions.push({ id: id as VideoCardActionId, hidden: LOCKED_VIDEO_CARD_ACTION_IDS.has(id as VideoCardActionId) ? false : hidden });
  }
  for (const action of DEFAULT_VIDEO_CARD_ACTION_CONFIG.actions) if (!seen.has(action.id)) actions.push({ ...action });
  return { version: 1, actions: [actions.find((action) => action.id === "schedule")!, ...actions.filter((action) => action.id !== "schedule")] };
}

export function normalizeVideoCardActionConfig(value: unknown): string {
  return JSON.stringify(parseVideoCardActionConfig(value) ?? DEFAULT_VIDEO_CARD_ACTION_CONFIG);
}

export const VIDEO_CARD_SWIPE_DEVICES = ["desktop", "tablet", "mobile"] as const;
export type VideoCardSwipeDevice = (typeof VIDEO_CARD_SWIPE_DEVICES)[number];
export type VideoCardSwipeConfig = { version: 1; devices: VideoCardSwipeDevice[] };
export const DEFAULT_VIDEO_CARD_SWIPE_CONFIG: VideoCardSwipeConfig = { version: 1, devices: [...VIDEO_CARD_SWIPE_DEVICES] };

export function parseVideoCardSwipeConfig(value: unknown): VideoCardSwipeConfig | null {
  if (typeof value === "string") {
    try { return parseVideoCardSwipeConfig(JSON.parse(value)); } catch { return null; }
  }
  if (!value || typeof value !== "object") return null;
  const config = value as { version?: unknown; devices?: unknown };
  if (config.version !== 1 || !Array.isArray(config.devices)) return null;
  const devices = config.devices;
  if (devices.some((device) => typeof device !== "string" || !(VIDEO_CARD_SWIPE_DEVICES as readonly string[]).includes(device))) return null;
  if (new Set(devices).size !== devices.length) return null;
  return { version: 1, devices: VIDEO_CARD_SWIPE_DEVICES.filter((device) => devices.includes(device)) };
}

export function normalizeVideoCardSwipeConfig(value: unknown): string {
  return JSON.stringify(parseVideoCardSwipeConfig(value) ?? DEFAULT_VIDEO_CARD_SWIPE_CONFIG);
}

export function validateVideoCardSettings(body: Record<string, unknown>): string | null {
  if ("video_card_actions" in body && !isVideoCardActionMode(body.video_card_actions)) return "invalid video card action mode";
  if ("video_card_preview" in body && !isVideoCardPreviewMode(body.video_card_preview)) return "invalid video card preview mode";
  if ("video_card_action_buttons" in body && !parseVideoCardActionConfig(body.video_card_action_buttons)) return "invalid video card action buttons";
  if ("video_card_swipe_devices" in body && !parseVideoCardSwipeConfig(body.video_card_swipe_devices)) return "invalid video card swipe devices";
  return null;
}

export function normalizeVideoCardSetting(key: string, value: unknown): string {
  if (key === "video_card_actions") return normalizeVideoCardActionMode(value);
  if (key === "video_card_preview") return isVideoCardPreviewMode(value) ? value : "all";
  if (key === "video_card_action_buttons") return normalizeVideoCardActionConfig(value);
  if (key === "video_card_swipe_devices") return normalizeVideoCardSwipeConfig(value);
  return String(value);
}
