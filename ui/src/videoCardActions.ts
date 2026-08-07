export type VideoCardActionsMode = "hover" | "always" | "bar_always" | "on_demand" | "delay" | "off";

export const DEFAULT_VIDEO_CARD_ACTIONS_MODE: VideoCardActionsMode = "hover";

export function parseVideoCardActionsMode(value: unknown): VideoCardActionsMode {
  switch (value) {
    case "hover":
    case "always":
    case "bar_always":
    case "on_demand":
    case "delay":
    case "off":
      return value;
    default:
      return DEFAULT_VIDEO_CARD_ACTIONS_MODE;
  }
}

export function applyVideoCardActionsMode(value: unknown) {
  document.documentElement.dataset.videoCardActions = parseVideoCardActionsMode(value);
}

export function readAppliedVideoCardActionsMode(): VideoCardActionsMode {
  return parseVideoCardActionsMode(document.documentElement.dataset.videoCardActions);
}
