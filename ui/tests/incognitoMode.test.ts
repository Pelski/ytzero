import { beforeEach, describe, expect, test } from "bun:test";
import { isIncognitoMode, setIncognitoAllowed, setIncognitoMode } from "../src/incognitoMode";

const values = new Map<string, string>();
const sessionStorage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); },
  removeItem: (key: string) => { values.delete(key); },
};

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { sessionStorage },
});

beforeEach(() => {
  values.clear();
  setIncognitoAllowed(true);
});

describe("incognito mode session state", () => {
  test("is off by default and toggles for the current tab", () => {
    expect(isIncognitoMode()).toBe(false);
    setIncognitoMode(true);
    expect(isIncognitoMode()).toBe(true);
    setIncognitoMode(false);
    expect(isIncognitoMode()).toBe(false);
  });

  test("fails closed when session storage is unavailable", () => {
    const original = window.sessionStorage.getItem;
    window.sessionStorage.getItem = () => { throw new Error("blocked"); };
    expect(isIncognitoMode()).toBe(false);
    window.sessionStorage.getItem = original;
  });

  test("cannot be enabled while the active profile is a child", () => {
    setIncognitoMode(true);
    setIncognitoAllowed(false);
    expect(isIncognitoMode()).toBe(false);
    expect(values.size).toBe(0);
    setIncognitoMode(true);
    expect(isIncognitoMode()).toBe(false);
    expect(values.size).toBe(0);
  });
});
