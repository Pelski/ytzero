import { describe, expect, test } from "bun:test";
import {
  AUDIO_CHUNK_BYTES,
  audioRangeHeader,
  parseAudioContentRange,
  parseAudioRange,
  parseAudioUnsatisfiedTotal,
  validateAudioRangeResponse,
} from "./audioRange";

describe("audio byte ranges", () => {
  test("turns a range-less request into one bounded first chunk", () => {
    const range = parseAudioRange(null);
    expect(range).toEqual({ start: 0, end: AUDIO_CHUNK_BYTES - 1, requested: false });
    expect(audioRangeHeader(range!)).toBe(`bytes=0-${AUDIO_CHUNK_BYTES - 1}`);
  });

  test("caps open and oversized explicit ranges", () => {
    expect(parseAudioRange("bytes=100-"))
      .toEqual({ start: 100, end: 100 + AUDIO_CHUNK_BYTES - 1, requested: true });
    expect(parseAudioRange("bytes=100-999999999"))
      .toEqual({ start: 100, end: 100 + AUDIO_CHUNK_BYTES - 1, requested: true });
    expect(parseAudioRange("bytes=100-199"))
      .toEqual({ start: 100, end: 199, requested: true });
  });

  test("rejects suffix, multipart, reversed, malformed, and unsafe ranges", () => {
    for (const value of [
      "bytes=-500",
      "bytes=0-1,4-5",
      "bytes=100-50",
      "items=0-10",
      "bytes=9007199254740992-",
      "garbage",
      "",
    ]) expect(parseAudioRange(value)).toBeNull();
  });
});

describe("audio Content-Range parsing", () => {
  test("accepts only internally consistent satisfied ranges", () => {
    expect(parseAudioContentRange("bytes 10-19/100")).toEqual({ start: 10, end: 19, total: 100 });
    expect(parseAudioContentRange("bytes 10-100/100")).toBeNull();
    expect(parseAudioContentRange("bytes 20-10/100")).toBeNull();
    expect(parseAudioContentRange("bytes 0-9/*")).toBeNull();
  });

  test("parses only valid unsatisfied totals", () => {
    expect(parseAudioUnsatisfiedTotal("bytes */1234")).toBe(1234);
    expect(parseAudioUnsatisfiedTotal("bytes 0-1/2")).toBeNull();
    expect(parseAudioUnsatisfiedTotal("bytes */9007199254740992")).toBeNull();
  });

  test("requires a matching 206 Content-Range and Content-Length", () => {
    const requested = { start: 10, end: 19, requested: true };
    expect(validateAudioRangeResponse(206, "bytes 10-19/100", "10", requested))
      .toEqual({ start: 10, end: 19, total: 100 });
    expect(validateAudioRangeResponse(200, "bytes 10-19/100", "10", requested)).toBeNull();
    expect(validateAudioRangeResponse(206, "bytes 0-9/100", "10", requested)).toBeNull();
    expect(validateAudioRangeResponse(206, "bytes 10-18/100", "9", requested)).toBeNull();
    expect(validateAudioRangeResponse(206, "bytes 10-19/100", null, requested)).toBeNull();
    expect(validateAudioRangeResponse(206, "bytes 10-19/100", "9", requested)).toBeNull();
  });
});
