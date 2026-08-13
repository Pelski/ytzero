import { describe, expect, test } from "bun:test";
import {
  shouldUseNativeVideoHls,
  videoHlsRecoveryAction,
  videoHlsRecoveryPosition,
  videoHlsStartPosition,
} from "./videoHlsPolicy";

describe("video HLS policy", () => {
  test("normalizes the initial position and avoids resuming an effectively completed video", () => {
    expect(videoHlsStartPosition(3_686, 7_200)).toBe(3_686);
    expect(videoHlsStartPosition(Number.NaN, 7_200)).toBe(0);
    expect(videoHlsStartPosition(7_198, 7_200)).toBe(0);
  });

  test("prefers native HLS whenever the media element advertises it", () => {
    expect(shouldUseNativeVideoHls("probably", "Apple Computer, Inc.")).toBe(true);
    expect(shouldUseNativeVideoHls("maybe", "Apple Computer, Inc.")).toBe(true);
    expect(shouldUseNativeVideoHls("probably", "Google Inc.")).toBe(false);
    expect(shouldUseNativeVideoHls("", "Apple Computer, Inc.")).toBe(false);
  });

  test("allows one recovery of each kind before surfacing a fatal error", () => {
    expect(videoHlsRecoveryAction({ fatal: false, type: "networkError", networkRecoveryUsed: false, mediaRecoveryUsed: false })).toBe("ignore");
    expect(videoHlsRecoveryAction({ fatal: true, type: "networkError", networkRecoveryUsed: false, mediaRecoveryUsed: false })).toBe("restart-network");
    expect(videoHlsRecoveryAction({ fatal: true, type: "networkError", networkRecoveryUsed: true, mediaRecoveryUsed: false })).toBe("fatal");
    expect(videoHlsRecoveryAction({ fatal: true, type: "mediaError", networkRecoveryUsed: false, mediaRecoveryUsed: false })).toBe("recover-media");
    expect(videoHlsRecoveryAction({ fatal: true, type: "mediaError", networkRecoveryUsed: false, mediaRecoveryUsed: true })).toBe("fatal");
  });

  test("reloads the master once for a stale HLS generation", () => {
    expect(videoHlsRecoveryAction({
      fatal: false, type: "networkError", responseCode: 410,
      masterReloadUsed: false, networkRecoveryUsed: false, mediaRecoveryUsed: false,
    })).toBe("reload-master");
    expect(videoHlsRecoveryAction({
      fatal: false, type: "networkError", responseCode: 410,
      masterReloadUsed: true, networkRecoveryUsed: false, mediaRecoveryUsed: false,
    })).toBe("fatal");
    expect(videoHlsRecoveryAction({
      fatal: true, type: "networkError", responseCode: 410,
      masterReloadPending: true, masterReloadUsed: true,
      networkRecoveryUsed: false, mediaRecoveryUsed: false,
    })).toBe("ignore");
    expect(videoHlsRecoveryAction({
      fatal: true, type: "networkError", responseCode: 410,
      masterReloadUsed: true, networkRecoveryUsed: false, mediaRecoveryUsed: false,
    })).toBe("fatal");
    expect(videoHlsRecoveryAction({
      fatal: true, type: "networkError", responseCode: 502,
      masterReloadUsed: false, networkRecoveryUsed: false, mediaRecoveryUsed: false,
    })).toBe("restart-network");
  });

  test("recovers at the exact current position after playback has started", () => {
    expect(videoHlsRecoveryPosition(0, 3_686, true)).toBe(0);
    expect(videoHlsRecoveryPosition(7_198, 3_686, true)).toBe(7_198);
    expect(videoHlsRecoveryPosition(0, 3_686, false)).toBe(3_686);
    expect(videoHlsRecoveryPosition(Number.NaN, 3_686, true)).toBe(3_686);
  });
});
