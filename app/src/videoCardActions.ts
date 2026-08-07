export const VIDEO_CARD_ACTION_MODES = ["hover", "always", "bar_always", "on_demand", "delay", "off"] as const;
export type VideoCardActionMode = (typeof VIDEO_CARD_ACTION_MODES)[number];

export function isVideoCardActionMode(value: unknown): value is VideoCardActionMode {
  return typeof value === "string" && (VIDEO_CARD_ACTION_MODES as readonly string[]).includes(value);
}

export function normalizeVideoCardActionMode(value: unknown): VideoCardActionMode {
  return isVideoCardActionMode(value) ? value : "hover";
}
