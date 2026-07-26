import { describe, expect, test } from "bun:test";
import { downloadCookieAttempts, downloadFormat } from "./downloadStrategy";

describe("download strategy", () => {
  test("caps every format fallback at the selected quality", () => {
    expect(downloadFormat("1080")).toBe(
      "bestvideo[height<=1080]+bestaudio/bestvideo*[height<=1080]/best[height<=1080]",
    );
  });

  test("keeps all best-quality fallbacks uncapped", () => {
    expect(downloadFormat("best")).toBe("bestvideo+bestaudio/bestvideo*/best");
  });

  test("tries public extraction before configured cookies", () => {
    expect(downloadCookieAttempts(true)).toEqual([false, true]);
    expect(downloadCookieAttempts(false)).toEqual([false]);
  });
});
