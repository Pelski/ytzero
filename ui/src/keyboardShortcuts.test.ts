import { describe, expect, test } from "bun:test";
import { DEFAULT_SHORTCUTS, parseShortcutOverrides, resolveShortcutBindings, serializeShortcutBindings, shortcutChordFromEvent, shortcutConflicts, shortcutMatches } from "./keyboardShortcuts";

const key = (code: string, modifiers: Partial<KeyboardEvent> = {}) => ({ code, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...modifiers });

describe("keyboard shortcut settings", () => {
  test("merges bounded overrides with defaults and round-trips disabled actions", () => {
    const bindings = resolveShortcutBindings('{"version":1,"bindings":{"togglePlay":"KeyX","toggleMute":null,"bogus":"KeyB"}}');
    expect(bindings.togglePlay).toBe("KeyX"); expect(bindings.toggleMute).toBe(null); expect(bindings.seekBack10).toBe("KeyJ");
    expect(parseShortcutOverrides(serializeShortcutBindings(bindings))).toEqual({ togglePlay: "KeyX", toggleMute: null });
  });
  test("matches modifiers and the digit family exactly", () => {
    expect(DEFAULT_SHORTCUTS.togglePictureInPicture).toBe("KeyI");
    expect(shortcutMatches(key("Comma", { shiftKey: true }), "Shift+Comma")).toBe(true);
    expect(shortcutMatches(key("Comma"), "Shift+Comma")).toBe(false);
    expect(shortcutMatches(key("Digit7"), "Digit0-9")).toBe(true);
    expect(shortcutChordFromEvent(key("KeyP", { shiftKey: true }))).toBe("Shift+KeyP");
  });
  test("reports collisions in the same player context", () => {
    expect(shortcutConflicts(DEFAULT_SHORTCUTS).size).toBe(0);
    expect(shortcutConflicts({ ...DEFAULT_SHORTCUTS, toggleMute: "KeyK" }).get("toggleMute")).toEqual(["togglePlay"]);
  });
});
