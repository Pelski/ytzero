import { afterEach, expect, test } from "bun:test";
import { api } from "./api";
import { loadLiveVideos } from "./liveActivity";

const originalLive = api.live;
afterEach(() => { api.live = originalLive; });

test("sidebar and Live page share an in-flight snapshot request", async () => {
  let calls = 0;
  let release!: (value: { videos: [] }) => void;
  api.live = () => {
    calls++;
    return new Promise((resolve) => { release = resolve; });
  };

  const sidebar = loadLiveVideos();
  const page = loadLiveVideos();
  expect(page).toBe(sidebar);
  expect(calls).toBe(1);
  release({ videos: [] });
  await sidebar;

  const next = loadLiveVideos();
  expect(calls).toBe(2);
  release({ videos: [] });
  await next;
});
