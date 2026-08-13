export type ShortcutCategory = "playback" | "subtitles" | "general";
export type ShortcutContext = "player";
export const SHORTCUT_CLOSE_EVENT = "ytzero:shortcut-close";

export const SHORTCUT_ACTIONS = [
  ["togglePlay", "playback", "player", "KeyK"], ["temporaryBoost", "playback", "player", "Space"],
  ["seekBack10", "playback", "player", "KeyJ"], ["seekForward10", "playback", "player", "KeyL"],
  ["previousVideo", "playback", "player", "Shift+KeyP"], ["nextVideo", "playback", "player", "Shift+KeyN"],
  ["previousFrame", "playback", "player", "Comma"], ["nextFrame", "playback", "player", "Period"],
  ["speedDown", "playback", "player", "Shift+Comma"], ["speedUp", "playback", "player", "Shift+Period"],
  ["seekPercent", "playback", "player", "Digit0-9"], ["previousChapter", "playback", "player", "Alt+ArrowLeft"],
  ["nextChapter", "playback", "player", "Alt+ArrowRight"], ["seekBack", "playback", "player", "ArrowLeft"],
  ["seekForward", "playback", "player", "ArrowRight"], ["volumeUp", "playback", "player", "ArrowUp"],
  ["volumeDown", "playback", "player", "ArrowDown"], ["toggleCaptions", "subtitles", "player", "KeyC"],
  ["subtitleLarger", "subtitles", "player", "Shift+Equal"], ["subtitleSmaller", "subtitles", "player", "Minus"],
  ["toggleFullscreen", "general", "player", "KeyF"], ["toggleTheater", "general", "player", "KeyT"],
  ["togglePictureInPicture", "general", "player", "KeyI"], ["close", "general", "player", "Escape"],
  ["toggleMute", "general", "player", "KeyM"], ["screenshot", "general", "player", "KeyS"],
] as const satisfies readonly (readonly [string, ShortcutCategory, ShortcutContext, string])[];

export type ShortcutAction = typeof SHORTCUT_ACTIONS[number][0];
export type ShortcutBindings = Record<ShortcutAction, string | null>;
export type ShortcutOverrides = Partial<ShortcutBindings>;

const ACTION_IDS = new Set<string>(SHORTCUT_ACTIONS.map(([id]) => id));
export const DEFAULT_SHORTCUTS = Object.fromEntries(SHORTCUT_ACTIONS.map(([id, , , chord]) => [id, chord])) as ShortcutBindings;
const MODIFIER_ORDER = ["Ctrl", "Alt", "Shift", "Meta"] as const;
const MODIFIERS = new Set<string>(MODIFIER_ORDER);
const CODE = /^(?:Key[A-Z]|Digit[0-9]|Digit0-9|F(?:[1-9]|1[0-2])|Numpad(?:Add|Subtract)|Arrow(?:Left|Right|Up|Down)|Space|Escape|Enter|Tab|Backspace|Delete|Home|End|PageUp|PageDown|Comma|Period|Minus|Equal|BracketLeft|BracketRight|Semicolon|Quote|Backslash|Slash|Backquote)$/;

export function normalizeShortcutChord(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > 80) return undefined;
  const parts = value.split("+");
  const code = parts.pop();
  if (!code || !CODE.test(code) || parts.some((part, index) => !MODIFIERS.has(part) || parts.indexOf(part) !== index)) return undefined;
  return [...MODIFIER_ORDER.filter((modifier) => parts.includes(modifier)), code].join("+");
}

export function parseShortcutOverrides(raw: unknown): ShortcutOverrides {
  if (typeof raw !== "string" || raw.length > 8_192) return {};
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; bindings?: unknown };
    if (parsed?.version !== 1 || !parsed.bindings || typeof parsed.bindings !== "object" || Array.isArray(parsed.bindings)) return {};
    const result: ShortcutOverrides = {};
    for (const [action, value] of Object.entries(parsed.bindings)) {
      const chord = normalizeShortcutChord(value);
      if (ACTION_IDS.has(action) && chord !== undefined) result[action as ShortcutAction] = chord;
    }
    return result;
  } catch { return {}; }
}

export function resolveShortcutBindings(raw: unknown): ShortcutBindings {
  return { ...DEFAULT_SHORTCUTS, ...parseShortcutOverrides(raw) };
}

export function serializeShortcutBindings(bindings: ShortcutBindings): string {
  const overrides: ShortcutOverrides = {};
  for (const [action] of SHORTCUT_ACTIONS) if (bindings[action] !== DEFAULT_SHORTCUTS[action]) overrides[action] = bindings[action];
  return JSON.stringify({ version: 1, bindings: overrides });
}

export function shortcutChordFromEvent(event: Pick<KeyboardEvent, "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "code">): string | null {
  if (!CODE.test(event.code) || event.code === "Digit0-9") return null;
  return [event.ctrlKey && "Ctrl", event.altKey && "Alt", event.shiftKey && "Shift", event.metaKey && "Meta", event.code].filter(Boolean).join("+");
}

export function shortcutMatches(event: Pick<KeyboardEvent, "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "code">, chord: string | null): boolean {
  if (!chord) return false;
  const eventChord = shortcutChordFromEvent(event);
  if (chord.endsWith("Digit0-9")) {
    const prefix = chord.slice(0, -"Digit0-9".length);
    return /^Digit[0-9]$/.test(event.code) && eventChord === `${prefix}${event.code}`;
  }
  return eventChord === chord;
}

export function shortcutActionMatches(action: ShortcutAction, event: Pick<KeyboardEvent, "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "code">, bindings: ShortcutBindings): boolean {
  return shortcutMatches(event, bindings[action]);
}

export function shortcutConflicts(bindings: ShortcutBindings): Map<ShortcutAction, ShortcutAction[]> {
  const conflicts = new Map<ShortcutAction, ShortcutAction[]>();
  for (let index = 0; index < SHORTCUT_ACTIONS.length; index++) {
    const [action, , context] = SHORTCUT_ACTIONS[index];
    const chord = bindings[action];
    if (!chord) continue;
    for (const [other, , otherContext] of SHORTCUT_ACTIONS.slice(index + 1)) {
      if (bindings[other] !== chord || context !== otherContext) continue;
      conflicts.set(action, [...(conflicts.get(action) ?? []), other]);
      conflicts.set(other, [...(conflicts.get(other) ?? []), action]);
    }
  }
  return conflicts;
}

export function formatShortcutChord(chord: string | null, mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)): string {
  if (!chord) return "—";
  const labels: Record<string, string> = { Ctrl: mac ? "⌃" : "Ctrl", Alt: mac ? "⌥" : "Alt", Shift: mac ? "⇧" : "Shift", Meta: mac ? "⌘" : "Meta", Space: "Space", Escape: "Esc", ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Comma: ",", Period: ".", Equal: "+", Minus: "−", BracketLeft: "[", BracketRight: "]", "Digit0-9": "0–9" };
  return chord.split("+").map((part) => labels[part] ?? part.replace(/^Key/, "").replace(/^Digit/, "").replace(/^Numpad/, "Num ")).join(mac ? " " : " + ");
}
