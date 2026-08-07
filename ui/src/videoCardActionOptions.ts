import type { I18nKey } from "./i18n";
import type { VideoCardActionsMode } from "./videoCardActions";
export type { VideoCardActionsMode } from "./videoCardActions";

export const VIDEO_CARD_ACTIONS_MODES: { id: VideoCardActionsMode; labelKey: I18nKey }[] = [
  { id: "hover", labelKey: "videoCardActionsHover" },
  { id: "always", labelKey: "videoCardActionsAlways" },
  { id: "bar_always", labelKey: "videoCardActionsBarAlways" },
  { id: "on_demand", labelKey: "videoCardActionsOnDemand" },
  { id: "delay", labelKey: "videoCardActionsDelay" },
  { id: "off", labelKey: "videoCardActionsOff" },
];
