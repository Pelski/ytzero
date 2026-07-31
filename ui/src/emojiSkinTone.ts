export const EMOJI_SKIN_TONES = ["neutral", "1f3fb", "1f3fc", "1f3fd", "1f3fe", "1f3ff"] as const;

export type EmojiSkinTone = (typeof EMOJI_SKIN_TONES)[number];

