const ACTIONS = new Set([
  "togglePlay", "temporaryBoost", "seekBack10", "seekForward10", "previousVideo", "nextVideo", "previousFrame", "nextFrame",
  "speedDown", "speedUp", "seekPercent", "previousChapter", "nextChapter", "seekBack", "seekForward", "volumeUp", "volumeDown",
  "toggleCaptions", "subtitleLarger", "subtitleSmaller", "toggleFullscreen", "toggleTheater", "togglePictureInPicture", "close", "toggleMute",
  "screenshot",
]);
const CHORD = /^(?:(?:Ctrl|Alt|Shift|Meta)\+)*(?:Key[A-Z]|Digit[0-9]|Digit0-9|F(?:[1-9]|1[0-2])|Numpad(?:Add|Subtract)|Arrow(?:Left|Right|Up|Down)|Space|Escape|Enter|Tab|Backspace|Delete|Home|End|PageUp|PageDown|Comma|Period|Minus|Equal|BracketLeft|BracketRight|Semicolon|Quote|Backslash|Slash|Backquote)$/;
const MODIFIER_ORDER = ["Ctrl", "Alt", "Shift", "Meta"];

export function normalizeKeyboardShortcutSetting(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 8_192) return null;
  try {
    const parsed = JSON.parse(value) as { version?: unknown; bindings?: unknown };
    if (parsed?.version !== 1 || !parsed.bindings || typeof parsed.bindings !== "object" || Array.isArray(parsed.bindings)) return null;
    const bindings: Record<string, string | null> = {};
    for (const [action, chord] of Object.entries(parsed.bindings)) {
      if (!ACTIONS.has(action) || (chord !== null && (typeof chord !== "string" || !CHORD.test(chord)))) return null;
      if (typeof chord === "string") { const modifiers = chord.split("+").slice(0, -1); if (modifiers.some((modifier, index) => modifier !== MODIFIER_ORDER.filter((candidate) => modifiers.includes(candidate))[index])) return null; }
      bindings[action] = chord as string | null;
    }
    return JSON.stringify({ version: 1, bindings });
  } catch { return null; }
}
