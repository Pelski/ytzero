import { describe, expect, test } from "bun:test";
import {
  DEFAULT_YTDLP_UPDATE_CHANNEL,
  resolveYtdlpUpdateChannel,
} from "./ytdlpUpdatePolicy";

describe("yt-dlp update-channel defaults", () => {
  test("uses nightly when no channel is saved", () => {
    expect(DEFAULT_YTDLP_UPDATE_CHANNEL).toBe("nightly");
    expect(resolveYtdlpUpdateChannel(null)).toBe("nightly");
  });

  test("never replaces an explicitly saved channel", () => {
    expect(resolveYtdlpUpdateChannel("stable")).toBe("stable");
    expect(resolveYtdlpUpdateChannel("nightly")).toBe("nightly");
  });
});
