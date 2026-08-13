import { afterEach, expect, test } from "bun:test";
import { profileAudioModeEnabled, rememberProfileAudioMode } from "./audioModePreference";

const values = new Map<string, string>();
const originalStorage = globalThis.localStorage;
const fakeStorage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); },
  removeItem: (key: string) => { values.delete(key); },
};

function installFakeStorage() {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: fakeStorage });
}

afterEach(() => {
  values.clear();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: originalStorage });
});

test("keeps audio mode device-local and isolated between profiles", () => {
  installFakeStorage();
  rememberProfileAudioMode(7, true);
  expect(profileAudioModeEnabled(7)).toBe(true);
  expect(profileAudioModeEnabled(8)).toBe(false);

  rememberProfileAudioMode(7, false);
  expect(profileAudioModeEnabled(7)).toBe(false);
});

test("does not create an unscoped preference without a profile", () => {
  installFakeStorage();
  rememberProfileAudioMode(null, true);
  expect(profileAudioModeEnabled(null)).toBe(false);
  expect(values.size).toBe(0);
});
