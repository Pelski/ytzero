import { describe, expect, test } from "bun:test";
import { resolveActiveLivestreams } from "./liveStatus";

const primary = {
  videoId: "primary0001",
  title: "Primary",
  thumbnail: "primary.jpg",
  isLiveNow: true,
  isUpcoming: false,
};

describe("live status discovery", () => {
  test("keeps every concurrent livestream and includes the primary result", () => {
    const result = resolveActiveLivestreams(primary, [
      { videoId: "stream00001", title: "One", thumbnail: "1.jpg", duration: "", viewCount: null, publishedAt: null, publishedAtApproximate: true, membersOnly: false, isLive: true },
      { videoId: "stream00002", title: "Two", thumbnail: "2.jpg", duration: "", viewCount: null, publishedAt: null, publishedAtApproximate: true, membersOnly: false, isLive: true },
    ]);

    expect(result.active.map((item) => item.videoId)).toEqual(["stream00001", "stream00002", "primary0001"]);
    expect(result.canDemoteMissing).toBe(true);
  });

  test("does not end sibling streams when the streams listing is unavailable", () => {
    const result = resolveActiveLivestreams(primary, undefined);
    expect(result.active).toHaveLength(1);
    expect(result.canDemoteMissing).toBe(false);
  });

  test("does not trust an empty parsed streams listing while /live still finds a broadcast", () => {
    expect(resolveActiveLivestreams(primary, []).canDemoteMissing).toBe(false);
  });

  test("can end old statuses after an authoritative no-live result", () => {
    expect(resolveActiveLivestreams(null, undefined)).toEqual({ active: [], canDemoteMissing: true });
  });
});
