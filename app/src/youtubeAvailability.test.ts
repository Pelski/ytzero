import { describe, expect, test } from "bun:test";
import {
  DeletedVideoError,
  classifyIsShort,
  isDeletedVideoError,
  isPrivateVideoError,
  PrivateVideoError,
  videoOEmbedAvailabilityFromStatus,
} from "./youtube";

describe("private video errors", () => {
  test("recognizes typed and YouTube player errors", () => {
    expect(isPrivateVideoError(new PrivateVideoError())).toBe(true);
    expect(isPrivateVideoError(new Error("videoDetails missing (LOGIN_REQUIRED: Private video)"))).toBe(true);
  });

  test("does not classify unrelated login errors as private", () => {
    expect(isPrivateVideoError(new Error("LOGIN_REQUIRED: Sign in to confirm you're not a bot"))).toBe(false);
  });
});

describe("deleted video errors", () => {
  test("recognizes typed and YouTube player deletion messages", () => {
    expect(isDeletedVideoError(new DeletedVideoError())).toBe(true);
    expect(isDeletedVideoError(new Error("videoDetails missing (ERROR: Video unavailable)"))).toBe(true);
    expect(isDeletedVideoError(new Error("This video has been removed by the uploader"))).toBe(true);
  });

  test("does not classify transient or authentication failures as deletions", () => {
    expect(isDeletedVideoError(new Error("YouTube fetch failed (503)"))).toBe(false);
    expect(isDeletedVideoError(new Error("Sign in to confirm you're not a bot"))).toBe(false);
  });
});

describe("oEmbed availability", () => {
  test("treats only authoritative statuses as available or unavailable", () => {
    expect(videoOEmbedAvailabilityFromStatus(200)).toBe("available");
    expect(videoOEmbedAvailabilityFromStatus(401)).toBe("unavailable");
    expect(videoOEmbedAvailabilityFromStatus(403)).toBe("unavailable");
    expect(videoOEmbedAvailabilityFromStatus(404)).toBe("unavailable");
    expect(videoOEmbedAvailabilityFromStatus(429)).toBe("unknown");
    expect(videoOEmbedAvailabilityFromStatus(503)).toBe("unknown");
  });

  test("does not classify a deleted video's 200 Shorts route as a Short", async () => {
    const statuses = [200, 404];
    const fetchImpl = (async () => new Response(null, { status: statuses.shift() })) as unknown as typeof fetch;
    expect(await classifyIsShort("deleted", "Ordinary title", fetchImpl)).toBeNull();
    expect(statuses).toEqual([]);
  });
});
