import { describe, expect, test } from "bun:test";
import type { Channel, ChannelSyncJob } from "./api";
import { channelCanSync, filterChannelSyncChoices, initialChannelSyncSelection, mergeChannelSyncResponse, newestChannelSyncJob } from "./channelSync";

const channel = (id: string, title: string, manual_status: Channel["manual_status"] = "active"): Channel => ({
  channel_id: id,
  title,
  url: `https://www.youtube.com/channel/${id}`,
  thumbnail: "",
  manual_status,
  tags: [],
});

const job = (id: string, revision: number, status: ChannelSyncJob["status"] = "running", startedAt = "2026-08-04T10:00:00.000Z"): ChannelSyncJob => ({
  id,
  sequence: id === "job-2" ? 2 : 1,
  userId: 1,
  revision,
  status,
  total: 2,
  processed: revision,
  succeeded: revision,
  failed: 0,
  skipped: 0,
  added: 0,
  currentChannelId: null,
  currentChannelTitle: null,
  startedAt,
  finishedAt: status === "running" ? null : "2026-08-04T10:05:00.000Z",
  channels: [],
});

describe("channel sync selection", () => {
  test("selects only active channels and treats an omitted status as active", () => {
    const withoutStatus = { ...channel("UC1", "One"), manual_status: undefined };
    const paused = channel("UC2", "Two", "paused");
    expect(channelCanSync(withoutStatus)).toBe(true);
    expect(initialChannelSyncSelection([withoutStatus, paused]).join(",")).toBe("UC1");
    expect(initialChannelSyncSelection([withoutStatus, paused], ["UC2", "UC1", "UC1"]).join(",")).toBe("UC1");
  });

  test("filters by title, handle or channel id", () => {
    const first = { ...channel("UC_ALPHA", "First creator"), handle: "@hello" };
    const second = channel("UC_BETA", "Drugi kanał");
    expect(filterChannelSyncChoices([first, second], "HELLO").map((item) => item.channel_id).join(",")).toBe("UC_ALPHA");
    expect(filterChannelSyncChoices([first, second], "beta").map((item) => item.channel_id).join(",")).toBe("UC_BETA");
  });
});

describe("channel sync snapshots", () => {
  test("ignores a lower revision of the same job", () => {
    expect(newestChannelSyncJob(job("job-1", 4), job("job-1", 3))?.revision).toBe(4);
    expect(newestChannelSyncJob(job("job-1", 4), job("job-1", 5))?.revision).toBe(5);
  });

  test("accepts an empty current snapshot after a server restart", () => {
    expect(newestChannelSyncJob(job("job-1", 2), null)).toBe(null);
    expect(newestChannelSyncJob(job("job-1", 2, "completed"), null)).toBe(null);
  });

  test("keeps a newer job when an older job arrives late", () => {
    const newer = job("job-2", 1, "running", "2026-08-04T10:00:00.000Z");
    const older = job("job-1", 20, "completed", "2026-08-04T10:00:00.000Z");
    expect(newestChannelSyncJob(newer, older)?.id).toBe("job-2");
  });

  test("keeps terminal SSE data when a newer request fails or a pre-POST null arrives late", () => {
    const terminal = job("job-1", 6, "completed");
    expect(mergeChannelSyncResponse(terminal, null, 3, 4)?.revision).toBe(6);
    expect(mergeChannelSyncResponse(job("job-1", 1), terminal, 2, 4)?.revision).toBe(6);
    expect(mergeChannelSyncResponse(terminal, null, 4, 4)).toBe(null);
  });
});
