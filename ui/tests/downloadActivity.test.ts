import { beforeEach, describe, expect, test } from "bun:test";
import { clearDownloadActivity, getNewCompletedDownloads, observeDownloadSummary } from "../src/downloadActivity";

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
  clearDownloadActivity();
});

describe("download activity session state", () => {
  test("uses the first summary as a baseline", () => {
    expect(observeDownloadSummary(12, false)).toBe(0);
    expect(getNewCompletedDownloads()).toBe(0);
  });

  test("counts only downloads completed after the baseline", () => {
    observeDownloadSummary(12, false);
    expect(observeDownloadSummary(15, false)).toBe(3);
    expect(observeDownloadSummary(16, false)).toBe(4);
  });

  test("does not treat removed downloads as new activity", () => {
    observeDownloadSummary(12, false);
    observeDownloadSummary(15, false);
    expect(observeDownloadSummary(10, false)).toBe(3);
  });

  test("marks completed downloads as seen while viewing downloads", () => {
    observeDownloadSummary(12, false);
    observeDownloadSummary(15, false);
    expect(observeDownloadSummary(16, true)).toBe(0);
    expect(observeDownloadSummary(17, false)).toBe(1);
  });
});
