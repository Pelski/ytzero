import { channelSyncMessages } from "./channelSync";
import { watchTogetherMessages } from "./watchTogether";

export const featureMessages = {
  en: { ...watchTogetherMessages.en, ...channelSyncMessages.en },
  pl: { ...watchTogetherMessages.pl, ...channelSyncMessages.pl },
  de: { ...watchTogetherMessages.de, ...channelSyncMessages.de },
} as const;
