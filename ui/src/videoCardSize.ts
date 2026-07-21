import { api } from "./api";

export const VIDEO_CARD_SIZE_MIN = 180;
export const VIDEO_CARD_SIZE_MAX = 480;
export const VIDEO_CARD_SIZE_DEFAULT = 248;

export function parseVideoCardSize(value: string | null | undefined): number {
  const legacy = value === "sm" ? 220 : value === "md" ? 320 : value === "lg" ? 360 : Number(value);
  return Number.isFinite(legacy) ? Math.min(VIDEO_CARD_SIZE_MAX, Math.max(VIDEO_CARD_SIZE_MIN, Math.round(legacy))) : VIDEO_CARD_SIZE_DEFAULT;
}

export function applyVideoCardSize(value: string | number | null | undefined) {
  document.documentElement.style.setProperty("--video-card-min", `${parseVideoCardSize(String(value ?? ""))}px`);
}

export function persistVideoCardSize(size: number) {
  const value = String(parseVideoCardSize(String(size)));
  applyVideoCardSize(value);
  return api.updateSettings({ grid_size: value });
}
