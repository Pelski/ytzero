import { describe, expect, test } from "bun:test";
import { formatTranscript } from "./transcriptFormatter";

describe("formatTranscript", () => {
  test("extracts only new words from cumulative captions", () => {
    expect(formatTranscript([
      "[00:01] Hello",
      "[00:02] Hello from YT Zero",
      "[00:03] Hello from YT Zero today",
    ].join("\n"))).toBe([
      "[00:01] Hello",
      "[00:02] from YT Zero",
      "[00:03] today",
    ].join("\n"));
  });

  test("merges rolling word overlap and keeps independent cues", () => {
    expect(formatTranscript([
      "[00:01] This is a rolling caption",
      "[00:03] a rolling caption with more words",
      "[00:05] A separate sentence",
    ].join("\n"))).toBe([
      "[00:01] This is a rolling caption",
      "[00:03] with more words",
      "[00:05] A separate sentence",
    ].join("\n"));
  });

  test("drops exact duplicates and shorter caption rollbacks", () => {
    expect(formatTranscript([
      "[00:01] Keep this complete sentence.",
      "[00:02] Keep this complete sentence",
      "[00:03] Keep this",
    ].join("\n"))).toBe("[00:01] Keep this complete sentence.");
  });

  test("does not merge a coincidental character overlap", () => {
    expect(formatTranscript("[00:01] world\n[00:02] welcome back"))
      .toBe("[00:01] world\n[00:02] welcome back");
  });

  test("returns non-timestamped input without discarding it", () => {
    expect(formatTranscript("  Plain transcript text  ")).toBe("Plain transcript text");
  });
});
