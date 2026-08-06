import { afterEach, expect, test } from "bun:test";
import type { Profile } from "./api";
import { forgetRememberedProfile, rememberProfile, rememberedProfileId, restorableRememberedProfile } from "./profilePreference";

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

test("remembers a valid device-local profile id", () => {
  installFakeStorage();
  rememberProfile(7);
  expect(rememberedProfileId()).toBe(7);
  forgetRememberedProfile();
  expect(rememberedProfileId()).toBe(null);
});

test("silently restores only a switchable profile without a PIN", () => {
  installFakeStorage();
  const profile = (id: number, can_switch: boolean, has_pin: boolean) => ({ id, can_switch, has_pin }) as Profile;
  rememberProfile(2);
  expect(restorableRememberedProfile([profile(1, true, false), profile(2, true, false)])?.id).toBe(2);
  expect(restorableRememberedProfile([profile(2, true, true)])).toBe(null);
  expect(restorableRememberedProfile([profile(2, false, false)])).toBe(null);
});
