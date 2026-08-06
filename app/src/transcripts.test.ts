import { describe, expect, test } from "bun:test";
import { webVttToTranscript } from "./transcripts";

describe("webVttToTranscript", () => {
  test("produces compact timestamped text and removes caption markup", () => {
    const vtt = `WEBVTT

00:00:01.200 --> 00:00:03.000
<c>Hello &amp; welcome</c>

00:01:05.000 --> 00:01:07.000 align:start position:0%
Next <00:01:06.000>part
`;
    expect(webVttToTranscript(vtt)).toBe("[00:01] Hello & welcome\n[01:05] Next part");
  });

  test("drops consecutive duplicate cues", () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:02.000
Same line

00:00:02.000 --> 00:00:03.000
Same line
`;
    expect(webVttToTranscript(vtt)).toBe("[00:01] Same line");
  });
});
