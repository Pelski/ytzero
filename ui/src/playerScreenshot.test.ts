import { describe, expect, test } from "bun:test";
import { buildScreenshotFilename, formatScreenshotTimestamp, parsePlayerScreenshotFormat } from "./playerScreenshot";

describe("player screenshots", () => {
  test("formats timestamps with optional milliseconds", () => {
    expect(formatScreenshotTimestamp(3723.456)).toBe("01-02-03");
    expect(formatScreenshotTimestamp(3723.456, true)).toBe("01-02-03-456");
  });

  test("renders a portable filename and removes filesystem-unsafe characters", () => {
    expect(buildScreenshotFilename({
      template: "{channel}_{title}_{timestamp_ms}_{video_id}",
      channel: "Channel / One",
      title: 'A: Video? "Yes"',
      videoId: "abc123",
      seconds: 65.009,
      format: "jpeg",
    })).toBe('Channel - One_A- Video- -Yes-_00-01-05-009_abc123.jpg');
  });

  test("falls back to JPEG and the default template", () => {
    expect(parsePlayerScreenshotFormat("invalid")).toBe("jpeg");
    expect(buildScreenshotFilename({ seconds: 0, format: "png" })).toBe("Channel_Video_00-00-00-000.png");
  });
});
