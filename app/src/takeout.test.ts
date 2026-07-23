import { describe, expect, test } from "bun:test";
import { deflateRawSync } from "node:zlib";
import { classifyCsv, isPlaylistCsvName, isZip, parseTakeoutFiles, parseTakeoutPlaylistCsv, parseWatchHistoryHtml, parseWatchHistoryJson, unzipEntries } from "./takeout";

describe("parseTakeoutPlaylistCsv", () => {
  test("reads video ids after the header and names the playlist from the file", () => {
    const csv = "Video Id,Playlist Video Creation Timestamp\ndQw4w9WgXcQ,2021-06-01T12:00:00+00:00\naaaaaaaaaaa,2021-06-02T12:00:00+00:00\n";
    const pl = parseTakeoutPlaylistCsv("Takeout/YouTube and YouTube Music/playlists/Favorites-videos.csv", csv);
    expect(pl).toEqual({ name: "Favorites", videoIds: ["dQw4w9WgXcQ", "aaaaaaaaaaa"] });
  });

  test("handles headerless exports and de-dupes", () => {
    const pl = parseTakeoutPlaylistCsv("Watch later.csv", "dQw4w9WgXcQ\ndQw4w9WgXcQ\nbbbbbbbbbbb\n");
    expect(pl.name).toBe("Watch later");
    expect(pl.videoIds).toEqual(["dQw4w9WgXcQ", "bbbbbbbbbbb"]);
  });

  test("skips metadata rows and blank lines", () => {
    const csv = "Playlist Name,My Mix\nPlaylist Description,\n\nVideo Id,Timestamp\nccccccccccc,2020-01-01\n";
    expect(parseTakeoutPlaylistCsv("x.csv", csv).videoIds).toEqual(["ccccccccccc"]);
  });

  test("returns no videos for a subscriptions export", () => {
    const csv = "Channel Id,Channel Url,Channel Title\nUC1234567890123456789012,https://...,Some Channel\n";
    expect(parseTakeoutPlaylistCsv("subscriptions.csv", csv).videoIds).toEqual([]);
  });
});

describe("parseWatchHistoryJson", () => {
  const entry = {
    header: "YouTube",
    title: "Watched Some &amp; Video",
    titleUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    subtitles: [{ name: "Some Channel", url: "https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw" }],
    time: "2024-03-05T17:45:37.000Z",
  };

  test("extracts video, channel, title and UTC timestamp", () => {
    const [e] = parseWatchHistoryJson(JSON.stringify([entry]));
    expect(e).toEqual({
      videoId: "dQw4w9WgXcQ",
      watchedAt: "2024-03-05 17:45:37",
      title: "Some & Video",
      channelId: "UCuAXFkgsw1L7xaCfnd5JJOw",
      channelTitle: "Some Channel",
    });
  });

  test("skips ads and entries without a watch URL", () => {
    const ad = { ...entry, details: [{ name: "From Google Ads" }] };
    const deleted = { header: "YouTube", title: "Watched a video that has been removed", time: "2024-01-01T00:00:00Z" };
    expect(parseWatchHistoryJson(JSON.stringify([ad, deleted]))).toEqual([]);
  });

  test("keeps entries with unparseable dates as undated", () => {
    const [e] = parseWatchHistoryJson(JSON.stringify([{ ...entry, time: "not a date" }]));
    expect(e.watchedAt).toBeNull();
  });

  test("ignores non-history JSON", () => {
    expect(parseWatchHistoryJson('{"foo": 1}')).toEqual([]);
    expect(parseWatchHistoryJson("not json")).toEqual([]);
  });
});

describe("parseWatchHistoryHtml", () => {
  const html = `
    <div class="outer-cell mdl-cell"><div class="mdl-grid">
      <div class="content-cell">Watched&nbsp;<a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">Never Gonna Give You Up</a><br>
      <a href="https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw">Rick Astley</a><br>Mar 5, 2024, 5:45:37 PM UTC</div>
    </div></div>`;

  test("extracts entries from outer-cell blocks", () => {
    const [e] = parseWatchHistoryHtml(html);
    expect(e.videoId).toBe("dQw4w9WgXcQ");
    expect(e.title).toBe("Never Gonna Give You Up");
    expect(e.channelId).toBe("UCuAXFkgsw1L7xaCfnd5JJOw");
    expect(e.channelTitle).toBe("Rick Astley");
    expect(e.watchedAt).toMatch(/^2024-03-05 /);
  });

  test("returns nothing for pages without watch links", () => {
    expect(parseWatchHistoryHtml("<html><body>search history</body></html>")).toEqual([]);
  });
});

describe("classifyCsv + parseTakeoutFiles", () => {
  const subsCsv = "Identyfikator kanału,URL kanału,Tytuły kanałów\nUCuAXFkgsw1L7xaCfnd5JJOw,https://x,Rick Astley\n";
  const playlistCsv = "Video Id,Timestamp\ndQw4w9WgXcQ,2021-06-01\n";

  test("classifies by content, not filename", () => {
    expect(classifyCsv(subsCsv)).toBe("subscriptions");
    expect(classifyCsv(playlistCsv)).toBe("playlist");
    expect(classifyCsv("Playlist Id,Title\nPL123,My mix\n")).toBe("other");
  });

  test("assembles a bundle and de-dupes history across formats", () => {
    const json = JSON.stringify([{
      title: "Watched X",
      titleUrl: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
      time: "2024-03-05T17:45:37.000Z",
    }]);
    const html = `<div class="outer-cell"><div class="content-cell"><a href="https://www.youtube.com/watch?v=aaaaaaaaaaa">X</a><br>Mar 5, 2024, 5:45:37 PM UTC</div></div>`;
    const bundle = parseTakeoutFiles([
      { name: "subskrypcje.csv", content: subsCsv },
      { name: "playlists/Ulubione.csv", content: playlistCsv },
      { name: "historia/historia.json", content: json },
      { name: "historia/historia.html", content: html },
    ]);
    expect(bundle.channels).toEqual([{ channelId: "UCuAXFkgsw1L7xaCfnd5JJOw", title: "Rick Astley" }]);
    expect(bundle.playlists).toEqual([{ name: "Ulubione", videoIds: ["dQw4w9WgXcQ"] }]);
    expect(bundle.history).toHaveLength(1);
  });
});

describe("file classification", () => {
  test("isPlaylistCsvName excludes the index and subscriptions files", () => {
    expect(isPlaylistCsvName("playlists/Favorites-videos.csv")).toBe(true);
    expect(isPlaylistCsvName("playlists.csv")).toBe(false);
    expect(isPlaylistCsvName("subscriptions.csv")).toBe(false);
    expect(isPlaylistCsvName("watch-history.json")).toBe(false);
  });
});

// Build a minimal ZIP (one deflate + one stored entry) to exercise the reader.
function buildZip(entries: { name: string; data: Uint8Array; store?: boolean }[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const enc = new TextEncoder();
  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const method = e.store ? 0 : 8;
    const body = e.store ? e.data : deflateRawSync(e.data);
    const local = new Uint8Array(30 + nameBytes.length + body.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, method, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, e.data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(body, 30 + nameBytes.length);
    chunks.push(local);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, method, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, e.data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);
    central.push(cd);
    offset += local.length;
  }
  const cdStart = offset;
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, cdStart, true);
  const out = [...chunks, ...central, eocd];
  const total = out.reduce((n, c) => n + c.length, 0);
  const buf = new Uint8Array(total);
  let p = 0;
  for (const c of out) { buf.set(c, p); p += c.length; }
  return buf;
}

describe("unzipEntries", () => {
  test("extracts wanted deflate and stored entries, skipping others", () => {
    const enc = new TextEncoder();
    const zip = buildZip([
      { name: "playlists/Favorites-videos.csv", data: enc.encode("Video Id\ndQw4w9WgXcQ\n") },
      { name: "playlists/Watch later.csv", data: enc.encode("Video Id\naaaaaaaaaaa\n"), store: true },
      { name: "subscriptions.csv", data: enc.encode("Channel Id\n") },
    ]);
    expect(isZip(zip)).toBe(true);
    const entries = unzipEntries(zip, isPlaylistCsvName);
    expect(entries.map((e) => e.name).sort()).toEqual([
      "playlists/Favorites-videos.csv",
      "playlists/Watch later.csv",
    ]);
    const favorites = entries.find((e) => e.name.includes("Favorites"))!;
    expect(new TextDecoder().decode(favorites.bytes)).toContain("dQw4w9WgXcQ");
  });
});
