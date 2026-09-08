import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectYouTubeCookieRecognition, mergeYouTubeSetCookies, refreshYouTubeCookieFile } from "./youtubeCookieJar";

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("YouTube cookie jar rotation", () => {
  test("merges YouTube cookies while preserving HttpOnly and unrelated domains", () => {
    const jar = [
      "# Netscape HTTP Cookie File",
      "#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t2208988800\tSID\told",
      ".google.com\tTRUE\t/\tTRUE\t2208988800\tOTHER\tpreserve-me",
      "",
    ].join("\n");
    const result = mergeYouTubeSetCookies(jar, [
      "SID=new; Domain=.youtube.com; Path=/; Expires=Sun, 1 Jan 2040 00:00:00 GMT; Secure; HttpOnly",
      "PREF=hl=en; Domain=.youtube.com; Path=/; Max-Age=600; Secure",
      "OTHER=do-not-import; Domain=.google.com; Path=/; Secure",
    ], "https://www.youtube.com/watch?v=abcdefghijk", 2_000_000_000);

    expect(result.updates).toBe(2);
    expect(result.contents).toContain("#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t2208988800\tSID\tnew");
    expect(result.contents).toContain(".youtube.com\tTRUE\t/\tTRUE\t2000000600\tPREF\thl=en");
    expect(result.contents).toContain(".google.com\tTRUE\t/\tTRUE\t2208988800\tOTHER\tpreserve-me");
    expect(result.contents).not.toContain("do-not-import");
    expect(result.contents.endsWith("\n")).toBe(true);
  });

  test("removes expired cookies and leaves an identical jar untouched", () => {
    const jar = [
      "# Netscape HTTP Cookie File",
      ".youtube.com\tTRUE\t/\tTRUE\t2208988800\tSID\tcurrent",
    ].join("\n");
    const unchanged = mergeYouTubeSetCookies(jar, [
      "SID=current; Domain=.youtube.com; Path=/; Expires=Sun, 1 Jan 2040 00:00:00 GMT; Secure",
    ], "https://www.youtube.com/", 2_000_000_000);
    expect(unchanged).toEqual({ contents: jar, updates: 0 });

    const removed = mergeYouTubeSetCookies(jar, [
      "SID=; Domain=.youtube.com; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure",
    ], "https://www.youtube.com/", 2_000_000_000);
    expect(removed.updates).toBe(1);
    expect(removed.contents).not.toContain("\tSID\t");
  });

  test("rejects non-YouTube and insecure request origins", () => {
    const jar = "# Netscape HTTP Cookie File\n";
    expect(mergeYouTubeSetCookies(jar, ["SID=x; Domain=.youtube.com"], "https://example.com/").updates).toBe(0);
    expect(mergeYouTubeSetCookies(jar, ["SID=x; Domain=.youtube.com"], "http://www.youtube.com/").updates).toBe(0);
  });

  test("atomically replaces a changed jar with private file permissions", () => {
    const directory = mkdtempSync(join(tmpdir(), "ytzero-cookie-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "cookies.txt");
    writeFileSync(path, "# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t2208988800\tSID\told\n", { mode: 0o644 });

    expect(refreshYouTubeCookieFile(path, [
      "SID=new; Domain=.youtube.com; Path=/; Expires=Sun, 1 Jan 2040 00:00:00 GMT; Secure",
    ], "https://www.youtube.com/")).toBe(1);
    expect(readFileSync(path, "utf8")).toContain("\tSID\tnew");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readdirSync(directory)).toEqual(["cookies.txt"]);
  });
});

describe("YouTube cookie recognition", () => {
  test("accepts each explicit signed-in marker", () => {
    expect(detectYouTubeCookieRecognition('{"LOGGED_IN":true}')).toBe(true);
    expect(detectYouTubeCookieRecognition('{"mainAppWebResponseContext":{"loggedOut":false}}')).toBe(true);
    expect(detectYouTubeCookieRecognition('{"key":"logged_in","value":"1"}')).toBe(true);
  });

  test("accepts explicit signed-out markers and otherwise stays unknown", () => {
    expect(detectYouTubeCookieRecognition('{"LOGGED_IN":false}')).toBe(false);
    expect(detectYouTubeCookieRecognition('{"mainAppWebResponseContext":{"loggedOut":true}}')).toBe(false);
    expect(detectYouTubeCookieRecognition('{"key":"logged_in","value":"0"}')).toBe(false);
    expect(detectYouTubeCookieRecognition("temporary upstream error")).toBeNull();
  });
});
