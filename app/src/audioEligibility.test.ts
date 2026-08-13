import { describe, expect, test } from "bun:test";
import { audioVideoIsEligible, liveAudioVideoIsEligible } from "./audioEligibility";

describe("audio playback eligibility", () => {
  test("allows regular and archived videos", () => {
    expect(audioVideoIsEligible({ live_status: "none", is_private: 0, members_only: 0 })).toBe(true);
    expect(audioVideoIsEligible({ live_status: "was_live", is_private: 0, members_only: 0 })).toBe(true);
  });

  test("rejects private, unavailable, members-only, live, and upcoming videos", () => {
    expect(audioVideoIsEligible({ live_status: "none", is_private: 1, members_only: 0 })).toBe(false);
    expect(audioVideoIsEligible({ live_status: "none", is_private: 0, is_unavailable: 1, members_only: 0 })).toBe(false);
    expect(audioVideoIsEligible({ live_status: "none", is_private: 0, members_only: 1 })).toBe(false);
    expect(audioVideoIsEligible({ live_status: "live", is_private: 0, members_only: 0 })).toBe(false);
    expect(audioVideoIsEligible({ live_status: "upcoming", is_private: 0, members_only: 0 })).toBe(false);
  });

  test("allows live audio only for a running public broadcast", () => {
    expect(liveAudioVideoIsEligible({ live_status: "live", is_private: 0, members_only: 0 })).toBe(true);
    expect(liveAudioVideoIsEligible({ live_status: "upcoming", is_private: 0, members_only: 0 })).toBe(false);
    expect(liveAudioVideoIsEligible({ live_status: "live", is_private: 1, members_only: 0 })).toBe(false);
    expect(liveAudioVideoIsEligible({ live_status: "live", is_private: 0, is_unavailable: 1, members_only: 0 })).toBe(false);
    expect(liveAudioVideoIsEligible({ live_status: "live", is_private: 0, members_only: 1 })).toBe(false);
  });
});
