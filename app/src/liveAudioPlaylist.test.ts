import { describe, expect, test } from "bun:test";
import { rewriteLiveAudioPlaylist } from "./liveAudioPlaylist";

describe("live audio playlist rewriting", () => {
  test("keeps the live edge and advances media and discontinuity sequences", () => {
    const source = [
      "#EXTM3U",
      "#EXT-X-VERSION:3",
      "#EXT-X-TARGETDURATION:5",
      "#EXT-X-MEDIA-SEQUENCE:100",
      "#EXT-X-DISCONTINUITY-SEQUENCE:7",
      "#EXTINF:5,", "https://r1.googlevideo.com/s0.ts",
      "#EXT-X-DISCONTINUITY", "#EXTINF:5,", "https://r1.googlevideo.com/s1.ts",
      "#EXTINF:5,", "https://r1.googlevideo.com/s2.ts",
      "#EXTINF:5,", "https://r1.googlevideo.com/s3.ts",
      "#EXTINF:5,", "https://r1.googlevideo.com/s4.ts",
    ].join("\n");
    const seen: string[] = [];
    const result = rewriteLiveAudioPlaylist(source, 2, (uri) => {
      seen.push(uri);
      return `r${seen.length - 1}`;
    });
    expect(result).toContain("#EXT-X-MEDIA-SEQUENCE:103");
    expect(result).toContain("#EXT-X-DISCONTINUITY-SEQUENCE:8");
    expect(result).toContain("\nr0\n#EXTINF:5,\nr1\n");
    expect(seen).toEqual([
      "https://r1.googlevideo.com/s3.ts",
      "https://r1.googlevideo.com/s4.ts",
    ]);
  });

  test("rewrites URI attributes and rejects master and ended playlists", () => {
    const media = "#EXTM3U\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:5,\nsegment.m4s\n";
    expect(rewriteLiveAudioPlaylist(media, 3, (uri) => `proxy-${uri}`))
      .toContain("#EXT-X-MAP:URI=\"proxy-init.mp4\"");
    expect(rewriteLiveAudioPlaylist("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nvariant.m3u8", 3, (uri) => uri)).toBeNull();
    expect(rewriteLiveAudioPlaylist("#EXTM3U\n#EXTINF:5,\nsegment.ts\n#EXT-X-ENDLIST", 3, (uri) => uri)).toBeNull();
  });
});
