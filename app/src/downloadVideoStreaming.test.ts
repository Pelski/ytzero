import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createDownloadVideoTranscodeStreaming } from "./downloadVideoTranscodeStreaming";

interface FakeProcessOptions {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  exited?: Promise<number>;
  onKill?: () => void;
}

function fakeProcess(options: FakeProcessOptions = {}): ReturnType<typeof Bun.spawn> {
  return {
    stdout: new Response(options.stdout ?? "").body!,
    stderr: new Response(options.stderr ?? "").body!,
    exited: options.exited ?? Promise.resolve(options.exitCode ?? 0),
    kill: options.onKill ?? (() => {}),
  } as unknown as ReturnType<typeof Bun.spawn>;
}

function argumentAfter(command: string[], name: string): string {
  const index = command.indexOf(name);
  if (index < 0 || command[index + 1] == null) throw new Error(`Missing ${name}`);
  return command[index + 1];
}

function probeOutput(source: string, duration = 7_200): string {
  return `${duration}\n30\n${source}\n${source.replace("/video", "/audio")}\n`;
}

const roots: string[] = [];

function testRoot(): string {
  const root = mkdtempSync(resolve(tmpdir(), "ytzero-video-hls-test-"));
  roots.push(root);
  return root;
}

function baseDependencies(root: string, spawn: typeof Bun.spawn) {
  return {
    DOWNLOADS_DIR: resolve(root, "downloads"),
    YTDLP: "yt-dlp",
    dlEnabled: async () => true,
    dlSettings: async () => ({ experimental_streaming: 1 as const, quality: "best" }),
    downloadCookiesConfigured: () => false,
    downloadCookiesFile: (userId: number) => `cookie-${userId}`,
    prioritizeDownload: async () => true,
    readLines: async (stream: ReadableStream<Uint8Array>, onLine: (line: string) => void) => {
      const text = await new Response(stream).text();
      for (const line of text.split(/\r?\n/).filter(Boolean)) onLine(line);
    },
    ytdlpStatus: async () => "2026.07.04",
    videoAvailable: async () => true,
    wait: async () => {},
    spawn,
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("experimental on-demand video HLS", () => {
  test("shares manifest creation and publishes it only after download ownership is ready", async () => {
    const root = testRoot();
    let probes = 0;
    let priorityCalls = 0;
    let releasePriority: (() => void) | null = null;
    const priorityReady = new Promise<void>((resolvePriority) => { releasePriority = resolvePriority; });
    const spawn = ((command: string[]) => {
      if (command[0] !== "yt-dlp") throw new Error("unexpected ffmpeg");
      probes += 1;
      return fakeProcess({ stdout: probeOutput("https://r1.googlevideo.com/video?expire=9999999999") });
    }) as unknown as typeof Bun.spawn;
    const dependencies = baseDependencies(root, spawn);
    dependencies.prioritizeDownload = async () => {
      priorityCalls += 1;
      await priorityReady;
      return true;
    };
    const streaming = createDownloadVideoTranscodeStreaming(dependencies);
    let resolutions = 0;
    const first = streaming.getHlsPlaylist(1, "single-flight").then((playlist) => { resolutions += 1; return playlist; });
    const second = streaming.getHlsPlaylist(1, "single-flight").then((playlist) => { resolutions += 1; return playlist; });

    while (priorityCalls === 0) await Promise.resolve();
    expect(probes).toBe(1);
    expect(priorityCalls).toBe(1);
    expect(resolutions).toBe(0);
    releasePriority!();
    const [firstPlaylist, secondPlaylist] = await Promise.all([first, second]);
    expect(firstPlaylist).toBe(secondPlaylist);
    expect(resolutions).toBe(2);
    streaming.resetHlsScratch();
  });

  test("aborts a hanging probe when its last request leaves and permits an immediate retry", async () => {
    const root = testRoot();
    let attempts = 0;
    let killed = false;
    let notifySpawned: (() => void) | null = null;
    const spawned = new Promise<void>((resolveSpawned) => { notifySpawned = resolveSpawned; });
    const spawn = ((command: string[]) => {
      if (command[0] !== "yt-dlp") throw new Error("unexpected ffmpeg");
      attempts += 1;
      if (attempts === 1) {
        notifySpawned!();
        return fakeProcess({ exited: new Promise(() => {}), onKill: () => { killed = true; } });
      }
      return fakeProcess({ stdout: probeOutput("https://r1.googlevideo.com/video-v2?expire=9999999999") });
    }) as unknown as typeof Bun.spawn;
    const streaming = createDownloadVideoTranscodeStreaming({ ...baseDependencies(root, spawn), probeTimeoutMs: 5_000 });
    const controller = new AbortController();
    const abandoned = streaming.getHlsPlaylist(1, "abort-probe", controller.signal);
    await spawned;
    controller.abort();

    expect(await abandoned).toBeNull();
    expect(killed).toBe(true);
    expect(await streaming.getHlsPlaylist(1, "abort-probe")).toContain("#EXTM3U");
    expect(attempts).toBe(2);
    streaming.resetHlsScratch();
  });

  test("bounds a probe that never exits", async () => {
    const root = testRoot();
    let killed = false;
    const spawn = (() => fakeProcess({
      exited: new Promise(() => {}),
      onKill: () => { killed = true; },
    })) as unknown as typeof Bun.spawn;
    const streaming = createDownloadVideoTranscodeStreaming({ ...baseDependencies(root, spawn), probeTimeoutMs: 5 });

    expect(await streaming.getHlsPlaylist(1, "timeout-probe")).toBeNull();
    expect(killed).toBe(true);
    streaming.resetHlsScratch();
  });

  test("starts a far seek at the requested segment instead of walking earlier media", async () => {
    const root = testRoot();
    let ffmpegCommand: string[] | null = null;
    const spawn = ((command: string[]) => {
      if (command[0] === "yt-dlp") {
        return fakeProcess({ stdout: probeOutput("https://r1.googlevideo.com/video?expire=9999999999") });
      }
      ffmpegCommand = command;
      const index = Number(argumentAfter(command, "-start_number"));
      const pattern = argumentAfter(command, "-hls_segment_filename");
      writeFileSync(pattern.replace("%05d", String(index).padStart(5, "0")), "segment");
      return fakeProcess();
    }) as unknown as typeof Bun.spawn;
    const streaming = createDownloadVideoTranscodeStreaming(baseDependencies(root, spawn));

    expect(await streaming.getHlsPlaylist(1, "long-video")).toContain("seg00615.ts");
    const segment = await streaming.getHlsSegment(1, "long-video", "seg00615.ts");

    expect(segment).not.toBeNull();
    expect(ffmpegCommand).not.toBeNull();
    const command = ffmpegCommand!;
    expect(argumentAfter(command, "-start_number")).toBe("615");
    expect(command.slice(0, 6)).toEqual([
      "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-protocol_whitelist",
    ]);
    expect(argumentAfter(command, "-protocol_whitelist")).toBe("file,https,tcp,tls");
    expect(argumentAfter(command, "-protocol_blacklist")).toContain("http");
    expect(command[command.indexOf("-ss") + 1]).toBe("3686");
    expect(command.filter((argument) => argument === "4")).toHaveLength(1);
    expect(existsSync(resolve(root, "hls-stream", "1", "long-video", "seg00000.ts"))).toBe(false);
    streaming.resetHlsScratch();
  });

  test("ignores local yt-dlp config and rejects non-googlevideo media URLs", async () => {
    const root = testRoot();
    let probeCommand: string[] = [];
    let ffmpegStarted = false;
    const spawn = ((command: string[]) => {
      if (command[0] === "yt-dlp") {
        probeCommand = command;
        return fakeProcess({ stdout: probeOutput("https://example.com/video?expire=9999999999") });
      }
      ffmpegStarted = true;
      return fakeProcess();
    }) as unknown as typeof Bun.spawn;
    const streaming = createDownloadVideoTranscodeStreaming(baseDependencies(root, spawn));

    expect(await streaming.getHlsPlaylist(1, "unsafe-source")).toBeNull();
    expect(probeCommand).toContain("--ignore-config");
    expect(ffmpegStarted).toBe(false);
    streaming.resetHlsScratch();
  });

  test("isolates source URLs and segment directories between profiles", async () => {
    const root = testRoot();
    const ffmpegCommands: string[][] = [];
    const spawn = ((command: string[]) => {
      if (command[0] === "yt-dlp") {
        const cookie = argumentAfter(command, "--cookies");
        return fakeProcess({ stdout: probeOutput(`https://r1.googlevideo.com/video-${cookie}?expire=9999999999`) });
      }
      ffmpegCommands.push(command);
      const index = Number(argumentAfter(command, "-start_number"));
      const pattern = argumentAfter(command, "-hls_segment_filename");
      writeFileSync(pattern.replace("%05d", String(index).padStart(5, "0")), "segment");
      return fakeProcess();
    }) as unknown as typeof Bun.spawn;
    const dependencies = baseDependencies(root, spawn);
    dependencies.downloadCookiesConfigured = () => true;
    const streaming = createDownloadVideoTranscodeStreaming(dependencies);

    await streaming.getHlsPlaylist(1, "shared-video");
    await streaming.getHlsPlaylist(2, "shared-video");
    const profileOneSegment = await streaming.getHlsSegment(1, "shared-video", "seg00010.ts");
    const profileTwoSegment = await streaming.getHlsSegment(2, "shared-video", "seg00010.ts");

    expect(ffmpegCommands).toHaveLength(2);
    expect(ffmpegCommands[0]).toContain("https://r1.googlevideo.com/video-cookie-1?expire=9999999999");
    expect(ffmpegCommands[1]).toContain("https://r1.googlevideo.com/video-cookie-2?expire=9999999999");
    expect(argumentAfter(ffmpegCommands[0], "-hls_segment_filename")).toContain("/hls-stream/1/shared-video/");
    expect(argumentAfter(ffmpegCommands[1], "-hls_segment_filename")).toContain("/hls-stream/2/shared-video/");
    streaming.destroyHlsSession("shared-video", 1);
    expect(existsSync(profileOneSegment!)).toBe(false);
    expect(existsSync(profileTwoSegment!)).toBe(true);
    streaming.resetHlsScratch();
  });

  test("re-resolves signed sources after a failed region and retries with the fresh URL", async () => {
    const root = testRoot();
    let probes = 0;
    const ffmpegSources: string[] = [];
    const spawn = ((command: string[]) => {
      if (command[0] === "yt-dlp") {
        probes += 1;
        return fakeProcess({ stdout: probeOutput(`https://r1.googlevideo.com/video-v${probes}?expire=9999999999`) });
      }
      ffmpegSources.push(argumentAfter(command, "-i"));
      if (ffmpegSources.length === 1) {
        return fakeProcess({ exitCode: 1, stderr: "Server returned 403 for https://r1.googlevideo.com/video-v1?secret=do-not-log" });
      }
      const index = Number(argumentAfter(command, "-start_number"));
      const pattern = argumentAfter(command, "-hls_segment_filename");
      writeFileSync(pattern.replace("%05d", String(index).padStart(5, "0")), "segment");
      return fakeProcess();
    }) as unknown as typeof Bun.spawn;
    const streaming = createDownloadVideoTranscodeStreaming(baseDependencies(root, spawn));

    await streaming.getHlsPlaylist(1, "refresh-video");
    const segment = await streaming.getHlsSegment(1, "refresh-video", "seg00020.ts");

    expect(segment).not.toBeNull();
    expect(probes).toBe(2);
    expect(ffmpegSources).toEqual([
      "https://r1.googlevideo.com/video-v1?expire=9999999999",
      "https://r1.googlevideo.com/video-v2?expire=9999999999",
    ]);
    streaming.resetHlsScratch();
  });

  test("kills a stalled region, refreshes its source, and respects request aborts", async () => {
    const root = testRoot();
    let clock = 0;
    let probes = 0;
    let ffmpegStarts = 0;
    let killed = false;
    const spawn = ((command: string[]) => {
      if (command[0] === "yt-dlp") {
        probes += 1;
        return fakeProcess({ stdout: probeOutput(`https://r1.googlevideo.com/video-v${probes}?expire=9999999999`) });
      }
      ffmpegStarts += 1;
      if (ffmpegStarts === 1) {
        return fakeProcess({ exited: new Promise(() => {}), onKill: () => { killed = true; } });
      }
      const index = Number(argumentAfter(command, "-start_number"));
      const pattern = argumentAfter(command, "-hls_segment_filename");
      writeFileSync(pattern.replace("%05d", String(index).padStart(5, "0")), "segment");
      return fakeProcess();
    }) as unknown as typeof Bun.spawn;
    const dependencies = {
      ...baseDependencies(root, spawn),
      now: () => clock,
      wait: async (milliseconds: number) => { clock += milliseconds; },
      regionStallMs: 300,
      segmentWaitMs: 2_000,
    };
    const streaming = createDownloadVideoTranscodeStreaming(dependencies);

    await streaming.getHlsPlaylist(1, "stalled-video");
    expect(await streaming.getHlsSegment(1, "stalled-video", "seg00030.ts")).not.toBeNull();
    expect(killed).toBe(true);
    expect(probes).toBe(2);

    const controller = new AbortController();
    controller.abort();
    expect(await streaming.getHlsSegment(1, "stalled-video", "seg00031.ts", controller.signal)).toBeNull();
    expect(ffmpegStarts).toBe(2);
    streaming.resetHlsScratch();
  });

  test("uses media-file progress instead of process age when detecting a stalled region", async () => {
    const root = testRoot();
    let clock = 0;
    let pattern = "";
    let waits = 0;
    let killed = false;
    const spawn = ((command: string[]) => {
      if (command[0] === "yt-dlp") {
        return fakeProcess({ stdout: probeOutput("https://r1.googlevideo.com/video?expire=9999999999") });
      }
      pattern = argumentAfter(command, "-hls_segment_filename");
      return fakeProcess({ exited: new Promise(() => {}), onKill: () => { killed = true; } });
    }) as unknown as typeof Bun.spawn;
    const streaming = createDownloadVideoTranscodeStreaming({
      ...baseDependencies(root, spawn),
      now: () => clock,
      wait: async (milliseconds: number) => {
        clock += milliseconds;
        waits += 1;
        const segment = pattern.replace("%05d", "00040");
        if (waits < 5) writeFileSync(`${segment}.tmp`, "x".repeat(waits));
        else writeFileSync(segment, "segment");
      },
      regionStallMs: 300,
      segmentWaitMs: 2_000,
    });

    await streaming.getHlsPlaylist(1, "progress-video");
    expect(await streaming.getHlsSegment(1, "progress-video", "seg00040.ts")).not.toBeNull();
    expect(killed).toBe(false);
    streaming.resetHlsScratch();
  });
});
