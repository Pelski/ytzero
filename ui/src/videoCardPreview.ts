export const VIDEO_CARD_PREVIEW_MODES = ["off", "downloaded", "all"] as const;
export type VideoCardPreviewMode = (typeof VIDEO_CARD_PREVIEW_MODES)[number];

let activePreviewStop: (() => void) | null = null;

export function parseVideoCardPreviewMode(value: unknown): VideoCardPreviewMode {
  return typeof value === "string" && (VIDEO_CARD_PREVIEW_MODES as readonly string[]).includes(value)
    ? value as VideoCardPreviewMode
    : "all";
}

export function applyVideoCardPreviewMode(value: unknown) {
  document.documentElement.dataset.videoCardPreview = parseVideoCardPreviewMode(value);
  activePreviewStop?.();
}

export function readVideoCardPreviewMode(): VideoCardPreviewMode {
  return parseVideoCardPreviewMode(document.documentElement.dataset.videoCardPreview);
}

export function claimVideoCardPreview(stop: () => void) {
  if (activePreviewStop !== stop) activePreviewStop?.();
  activePreviewStop = stop;
}

export function releaseVideoCardPreview(stop: () => void) {
  if (activePreviewStop === stop) activePreviewStop = null;
}
