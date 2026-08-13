import { describe, expect, test } from "bun:test";
import { shouldFallbackFromHlsJs, shouldFallbackFromNativeHls } from "./audioMediaSourcePolicy";

describe("audio media source fallback policy", () => {
  test("uses the progressive source only for a missing VOD HLS manifest", () => {
    expect(shouldFallbackFromHlsJs({ hasProgressiveSource: true, live: false, sourceReady: false, status: 404 })).toBe(true);
    expect(shouldFallbackFromHlsJs({ hasProgressiveSource: true, live: false, sourceReady: false, status: 502 })).toBe(false);
    expect(shouldFallbackFromHlsJs({ hasProgressiveSource: true, live: false, sourceReady: true, status: 404 })).toBe(false);
    expect(shouldFallbackFromHlsJs({ hasProgressiveSource: true, live: true, sourceReady: false, status: 404 })).toBe(false);
  });

  test("allows native HLS fallback only before VOD metadata is available", () => {
    expect(shouldFallbackFromNativeHls({ hasProgressiveSource: true, live: false, sourceReady: false })).toBe(true);
    expect(shouldFallbackFromNativeHls({ hasProgressiveSource: true, live: false, sourceReady: true })).toBe(false);
    expect(shouldFallbackFromNativeHls({ hasProgressiveSource: true, live: true, sourceReady: false })).toBe(false);
  });
});
