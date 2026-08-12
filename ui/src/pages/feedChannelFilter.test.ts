import { describe, expect, test } from "bun:test";
import type { Channel } from "../api";
import { filterChannelsByTags } from "./feedChannelFilter";

function channel(channel_id: string, tagIds: number[]): Channel {
  return {
    channel_id,
    title: channel_id,
    url: "",
    thumbnail: "",
    tags: tagIds.map((id) => ({ id, name: `tag-${id}`, color: "#000000" })),
  };
}

describe("filterChannelsByTags", () => {
  const channels = [channel("one", [1]), channel("two", [2, 3]), channel("none", [])];

  test("keeps the complete channel list without an active tag filter", () => {
    expect(filterChannelsByTags(channels, [])).toEqual(channels);
  });

  test("returns every channel matching any selected feed tag", () => {
    expect(filterChannelsByTags(channels, [1, 3]).map((item) => item.channel_id)).toEqual(["one", "two"]);
  });
});
