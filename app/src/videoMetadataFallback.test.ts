import { describe, expect, test } from "bun:test";
import { PrivateVideoError } from "./youtubeVideoAvailability";
import {
  chooseMetadataCookieProfile,
  MetadataCookieFallbackBudget,
  parseYtdlpVideoInfo,
  retryVideoInfoWithCookies,
  type MetadataCookieFallbackDependencies,
} from "./videoMetadataFallback";

function dependencies(options: {
  profiles?: number[];
  configured?: number[];
  response?: { stdout: string; stderr: string; exitCode: number; timedOut?: boolean };
} = {}) {
  const commands: string[][] = [];
  const events: Array<{ level: "info" | "warn"; event: string; meta?: Record<string, unknown> }> = [];
  const configured = new Set(options.configured ?? [1]);
  const deps: MetadataCookieFallbackDependencies = {
    listProfileIds: async () => options.profiles ?? [1, 2],
    cookiesConfigured: (userId) => configured.has(userId),
    command: (userId, args) => ["yt-dlp", `profile:${userId}`, "--cookies", `${userId}.txt`, ...args],
    run: async (command) => {
      commands.push(command);
      return options.response ?? {
        stdout: JSON.stringify({
          id: "video-id",
          title: "Cookie-backed title",
          channel_id: "UC-cookie-channel",
          channel: "Cookie channel",
          duration: 125,
          upload_date: "20260817",
          view_count: 42,
        }),
        stderr: "",
        exitCode: 0,
      };
    },
    logger: {
      info: (event, meta) => events.push({ level: "info", event, meta }),
      warn: (event, meta) => events.push({ level: "warn", event, meta }),
    },
  };
  return { deps, commands, events };
}

describe("metadata cookie fallback", () => {
  test("prefers the requesting profile and otherwise borrows the first configured jar", () => {
    const configured = (userId: number) => userId === 1 || userId === 3;
    expect(chooseMetadataCookieProfile([1, 2, 3], 3, configured)).toBe(3);
    expect(chooseMetadataCookieProfile([1, 2, 3], 2, configured)).toBe(1);
    expect(chooseMetadataCookieProfile([1, 2, 3], undefined, configured)).toBe(1);
    expect(chooseMetadataCookieProfile([1, 2, 3], 2, () => false)).toBeNull();
  });

  test("normalizes yt-dlp JSON into the existing VideoInfo shape", () => {
    expect(parseYtdlpVideoInfo("requested-id", JSON.stringify({
      id: "actual-id",
      title: "Title",
      channel_id: "UC123",
      channel: "Channel",
      description: "Description",
      thumbnails: [{ url: "small" }, { url: "large" }],
      view_count: 123,
      upload_date: "20260908",
      duration: 3723,
      live_status: "was_live",
    }))).toEqual({
      videoId: "actual-id",
      title: "Title",
      channelId: "UC123",
      channelTitle: "Channel",
      description: "Description",
      thumbnail: "large",
      viewCount: 123,
      publishedAt: "2026-09-08",
      duration: "62:03",
      liveStatus: "was_live",
    });
  });

  test("uses the viewer's own jar without logging a borrowed identity", async () => {
    const { deps, commands, events } = dependencies({ configured: [2] });
    const info = await retryVideoInfoWithCookies("video-id", new Error("refused"), { userId: 2 }, deps);

    expect(info.title).toBe("Cookie-backed title");
    expect(commands).toHaveLength(1);
    expect(commands[0]).toContain("profile:2");
    expect(commands[0]).toContain("--dump-single-json");
    expect(events.some(({ event }) => event === "youtube.metadata_cookie_profile_borrowed")).toBe(false);
  });

  test("logs when an interactive or scheduled lookup borrows another profile's jar", async () => {
    const interactive = dependencies({ configured: [1] });
    await retryVideoInfoWithCookies("interactive", new Error("refused"), { userId: 2 }, interactive.deps);
    expect(interactive.events.find(({ event }) => event === "youtube.metadata_cookie_profile_borrowed")?.meta)
      .toMatchObject({ videoId: "interactive", requestedProfileId: 2, cookieProfileId: 1 });

    const scheduled = dependencies({ configured: [1] });
    await retryVideoInfoWithCookies("scheduled", new Error("refused"), {}, scheduled.deps);
    expect(scheduled.events.find(({ event }) => event === "youtube.metadata_cookie_profile_borrowed")?.meta)
      .toMatchObject({ videoId: "scheduled", requestedProfileId: null, cookieProfileId: 1 });
  });

  test("enforces one shared three-attempt budget and leaves later videos for another batch", async () => {
    const { deps, commands } = dependencies();
    const budget = new MetadataCookieFallbackBudget(3);
    for (const videoId of ["one", "two", "three"]) {
      await retryVideoInfoWithCookies(videoId, new Error(`refused:${videoId}`), { budget }, deps);
    }
    const fourthRefusal = new Error("refused:four");
    let rejected: unknown;
    try {
      await retryVideoInfoWithCookies("four", fourthRefusal, { budget }, deps);
    } catch (error) {
      rejected = error;
    }
    expect(rejected).toBe(fourthRefusal);
    expect(commands).toHaveLength(3);
    expect(budget.remaining()).toBe(0);
  });

  test("does not spend budget when the instance has no jar and preserves private answers", async () => {
    const noJar = dependencies({ configured: [] });
    const budget = new MetadataCookieFallbackBudget();
    const refusal = new Error("anonymous refusal");
    await expect(retryVideoInfoWithCookies("no-jar", refusal, { budget }, noJar.deps)).rejects.toBe(refusal);
    expect(budget.remaining()).toBe(3);
    expect(noJar.commands).toHaveLength(0);

    const privateResult = dependencies({
      response: { stdout: "", stderr: "ERROR: Private video", exitCode: 1 },
    });
    await expect(retryVideoInfoWithCookies("private", refusal, {}, privateResult.deps)).rejects.toBeInstanceOf(PrivateVideoError);
  });
});
