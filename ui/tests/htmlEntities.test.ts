import { describe, expect, test } from "bun:test";
import { decodeApiTitles, decodeHtmlEntities } from "../src/htmlEntities";

describe("HTML entity normalization", () => {
  test("decodes the title regression", () => {
    expect(decodeHtmlEntities("I&#39;m annoyed about how good this is..."))
      .toBe("I'm annoyed about how good this is...");
  });

  test("normalizes nested API title fields without changing user names", () => {
    const payload = {
      video: { title: "Rock &amp; Roll", channel_title: "Tom &amp; Co" },
      results: [{ channelTitle: "A&#39;s channel" }],
      playlist: { name: "My &amp; playlist" },
    };

    expect(decodeApiTitles(payload)).toEqual({
      video: { title: "Rock & Roll", channel_title: "Tom & Co" },
      results: [{ channelTitle: "A's channel" }],
      playlist: { name: "My &amp; playlist" },
    });
  });
});
