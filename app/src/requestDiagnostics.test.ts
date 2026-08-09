import { describe, expect, test } from "bun:test";
import { diagnosticRequestPath, isExpectedRequestMiss } from "./requestDiagnostics";

describe("request diagnostics", () => {
  test("keeps expected image fallback misses out of warning logs", () => {
    expect(isExpectedRequestMiss("/api/img", 404, "error")).toBe(true);
    expect(isExpectedRequestMiss("/api/img", 404, undefined)).toBe(false);
    expect(isExpectedRequestMiss("/api/img", 500, "error")).toBe(false);
    expect(isExpectedRequestMiss("/api/other", 404, "error")).toBe(false);
  });

  test("redacts watch-party bearer ids", () => {
    expect(diagnosticRequestPath("/api/social/watch-parties/secret/messages"))
      .toBe("/api/social/watch-parties/:id/messages");
  });
});
