import { channelSyncMessages } from "./channelSync";
import { watchTogetherMessages } from "./watchTogether";
import { keyboardShortcutMessages } from "./keyboardShortcuts";

export const featureMessages = {
  en: { ...watchTogetherMessages.en, ...channelSyncMessages.en, ...keyboardShortcutMessages.en },
  pl: { ...watchTogetherMessages.pl, ...channelSyncMessages.pl, ...keyboardShortcutMessages.pl },
  de: { ...watchTogetherMessages.de, ...channelSyncMessages.de, ...keyboardShortcutMessages.de },
} as const;
