import { describe, expect, test } from "bun:test";
import { DOWNLOAD_QUALITIES, isDownloadQuality, resolveDownloadQuality } from "./downloadSettings";

describe("download quality values", () => {
  test("accepts only qualities exposed by download settings and playlists", () => {
    expect(DOWNLOAD_QUALITIES).toEqual(["best", "1440", "1080", "720", "480"]);
    for (const quality of DOWNLOAD_QUALITIES) expect(isDownloadQuality(quality)).toBe(true);
    for (const quality of [null, "", "2160", "720p", 720]) expect(isDownloadQuality(quality)).toBe(false);
  });

  test("uses a playlist override without changing the profile fallback", () => {
    expect(resolveDownloadQuality("1080", "720")).toBe("720");
    expect(resolveDownloadQuality("1080", null)).toBe("1080");
    expect(resolveDownloadQuality("1080", "2160")).toBe("1080");
  });
});
