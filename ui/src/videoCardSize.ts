import { scheduleSettingWrite } from "./settingsWriteQueue";
import { emit } from "./events";

export const VIDEO_CARD_SIZE_MIN = 180;
export const VIDEO_CARD_SIZE_MAX = 480;
export const VIDEO_CARD_SIZE_DEFAULT = 248;

export function parseVideoCardSize(value: string | null | undefined): number {
  const legacy = value === "sm" ? 220 : value === "md" ? 320 : value === "lg" ? 360 : Number(value);
  return Number.isFinite(legacy) ? Math.min(VIDEO_CARD_SIZE_MAX, Math.max(VIDEO_CARD_SIZE_MIN, Math.round(legacy))) : VIDEO_CARD_SIZE_DEFAULT;
}

export function scheduledThumbnailWidth(value: string | number | null | undefined): number {
  const cardSize = parseVideoCardSize(String(value ?? ""));
  return Math.round(88 + (cardSize - VIDEO_CARD_SIZE_MIN) / 4);
}

export function applyVideoCardSize(value: string | number | null | undefined) {
  const cardSize = parseVideoCardSize(String(value ?? ""));
  document.documentElement.style.setProperty("--video-card-min", `${cardSize}px`);
  document.documentElement.style.setProperty("--scheduled-thumb-w", `${scheduledThumbnailWidth(cardSize)}px`);
}

export function persistVideoCardSize(size: number) {
  const value = String(parseVideoCardSize(String(size)));
  applyVideoCardSize(value);
  scheduleSettingWrite("grid_size", { grid_size: value }, {
    onSaved: () => emit("video-card-size-changed"),
    onError: () => emit("video-card-size-changed"),
  });
}
