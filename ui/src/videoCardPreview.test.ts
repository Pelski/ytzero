import { describe, expect, test } from "bun:test";
import { parseVideoCardPreviewMode } from "./videoCardPreview";
import { youtubeCardPreviewPlayerVars } from "./components/VideoCardHoverPreview";

describe("video card hover preview", () => {
  test("normalizes the portable preview policy", () => {
    expect(parseVideoCardPreviewMode("off")).toBe("off");
    expect(parseVideoCardPreviewMode("downloaded")).toBe("downloaded");
    expect(parseVideoCardPreviewMode("all")).toBe("all");
    expect(parseVideoCardPreviewMode("invalid")).toBe("all");
  });

  test("builds a muted, control-free YouTube player", () => {
    const vars = youtubeCardPreviewPlayerVars("dQw4w9WgXcQ", 12.9, "https://ytzero.example");
    expect(vars.autoplay).toBe(1);
    expect(vars.mute).toBe(1);
    expect(vars.controls).toBe(0);
    expect(vars.cc_load_policy).toBe(0);
    expect(vars.fs).toBe(0);
    expect(vars.start).toBe(12);
    expect(vars.origin).toBe("https://ytzero.example");
    expect(vars.ytzero_preview).toBe(1);
  });
});
