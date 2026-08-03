import type { I18nKey } from "./i18n";

export type VideoCardActionsMode = "hover" | "always" | "on_demand" | "delay" | "off";

export const DEFAULT_VIDEO_CARD_ACTIONS_MODE: VideoCardActionsMode = "hover";

export const VIDEO_CARD_ACTIONS_MODES: { id: VideoCardActionsMode; labelKey: I18nKey }[] = [
  { id: "hover", labelKey: "videoCardActionsHover" },
  { id: "always", labelKey: "videoCardActionsAlways" },
  { id: "on_demand", labelKey: "videoCardActionsOnDemand" },
  { id: "delay", labelKey: "videoCardActionsDelay" },
  { id: "off", labelKey: "videoCardActionsOff" },
];

export function parseVideoCardActionsMode(value: unknown): VideoCardActionsMode {
  return VIDEO_CARD_ACTIONS_MODES.some((mode) => mode.id === value)
    ? value as VideoCardActionsMode
    : DEFAULT_VIDEO_CARD_ACTIONS_MODE;
}

export function applyVideoCardActionsMode(value: unknown) {
  document.documentElement.dataset.videoCardActions = parseVideoCardActionsMode(value);
}

export function readAppliedVideoCardActionsMode(): VideoCardActionsMode {
  return parseVideoCardActionsMode(document.documentElement.dataset.videoCardActions);
}
