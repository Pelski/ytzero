import { describe, expect, test } from "bun:test";
import { downloadCookieAttempts, downloadFormat, renderDownloadOutputTemplate } from "./downloadStrategy";

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

  test("renders playlist context only when the download supplies it", () => {
    const template = "{playlist}/{date} - {title} [{id}]";
    const base = { id: "abc123", date: "2026-07-27", title: "Episode", playlist: "Season 1" };
    expect(renderDownloadOutputTemplate(template, base, "abc123")).toBe("Season 1/2026-07-27 - Episode [abc123]");
    expect(renderDownloadOutputTemplate(template, { ...base, playlist: "" }, "abc123")).toBe("2026-07-27 - Episode [abc123]");
  });

  test("keeps Unicode filenames readable and replaces unsafe punctuation cleanly", () => {
    expect(renderDownloadOutputTemplate(
      "{title}-{id}",
      { title: "Radny | Świat według Kiepskich: AC/DC?", id: "kDELi-mhCSc" },
      "kDELi-mhCSc",
    )).toBe("Radny - Świat według Kiepskich - AC - DC-kDELi-mhCSc");
  });
});
