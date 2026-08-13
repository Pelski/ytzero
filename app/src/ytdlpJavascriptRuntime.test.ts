import { describe, expect, test } from "bun:test";
import { supportedDenoVersion } from "./ytdlpJavascriptRuntime";

describe("yt-dlp JavaScript runtime", () => {
  test("accepts the supported Deno release output", () => {
    expect(supportedDenoVersion("deno 2.8.1 (stable, release, aarch64-unknown-linux-gnu)\nv8 14.2"))
      .toBe("2.8.1");
    expect(supportedDenoVersion("deno 3.0.0\n")).toBe("3.0.0");
  });

  test("rejects a missing, malformed, or obsolete runtime", () => {
    expect(supportedDenoVersion("")).toBeNull();
    expect(supportedDenoVersion("node v24.0.0")).toBeNull();
    expect(supportedDenoVersion("deno 2.2.9")).toBeNull();
  });
});
