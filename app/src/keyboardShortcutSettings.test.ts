import { describe, expect, test } from "bun:test";
import { normalizeKeyboardShortcutSetting } from "./keyboardShortcutSettings";

describe("keyboard shortcut setting", () => {
  test("normalizes bounded known overrides", () => expect(normalizeKeyboardShortcutSetting('{"bindings":{"togglePlay":"Shift+KeyX","toggleMute":null},"version":1}')).toBe('{"version":1,"bindings":{"togglePlay":"Shift+KeyX","toggleMute":null}}'));
  test("accepts native picture-in-picture binding", () => expect(normalizeKeyboardShortcutSetting('{"version":1,"bindings":{"togglePictureInPicture":"KeyI"}}')).toBe('{"version":1,"bindings":{"togglePictureInPicture":"KeyI"}}'));
  test("rejects unknown actions, invalid chords and malformed documents", () => {
    expect(normalizeKeyboardShortcutSetting('{"version":1,"bindings":{"unknown":"KeyX"}}')).toBeNull();
    expect(normalizeKeyboardShortcutSetting('{"version":1,"bindings":{"togglePlay":"Nope"}}')).toBeNull();
    expect(normalizeKeyboardShortcutSetting('{"version":1,"bindings":{"togglePlay":"Shift+Ctrl+KeyX"}}')).toBeNull();
    expect(normalizeKeyboardShortcutSetting("[]")).toBeNull();
  });
});
