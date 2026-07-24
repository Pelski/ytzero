import { describe, expect, test } from "bun:test";
import { channelUnavailableReason } from "./channelAvailability";

describe("channel availability failures", () => {
  test("recognizes permanent missing-channel responses", () => {
    expect(channelUnavailableReason(new Error("RSS fetch failed (404) for UCmissing"))).toBe("not_found");
    expect(channelUnavailableReason(new Error("This channel does not exist"))).toBe("not_found");
    expect(channelUnavailableReason(new Error("Channel has been terminated"))).toBe("not_found");
  });

  test("keeps transient and ambiguous failures retryable", () => {
    expect(channelUnavailableReason(new Error("RSS fetch failed (429) for UCrate"))).toBeNull();
    expect(channelUnavailableReason(new Error("RSS fetch failed (503) for UCdown"))).toBeNull();
    expect(channelUnavailableReason(new Error("network timeout"))).toBeNull();
  });
});
