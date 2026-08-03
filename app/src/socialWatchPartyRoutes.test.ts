import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = mkdtempSync(resolve(tmpdir(), "ytzero-social-watch-party-routes-test-"));
let result: Record<string, any> = {};

beforeAll(async () => {
  const child = Bun.spawn([process.execPath, "app/tests/socialWatchPartyRoutesHarness.ts"], {
    cwd: resolve(import.meta.dir, "../.."),
    env: {
      ...Bun.env,
      DB_PATH: resolve(root, "db", "watch-party.db"),
      AVATAR_DIR: resolve(root, "avatars"),
      DOWNLOADS_DIR: resolve(root, "downloads"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) throw new Error(`Watch party route harness failed:\n${stderr}\n${stdout}`);
  const line = stdout.split("\n").find((entry) => entry.startsWith("RESULT "));
  if (!line) throw new Error(`Watch party route harness returned no result:\n${stdout}`);
  result = JSON.parse(line.slice("RESULT ".length));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("Social watch party HTTP routes", () => {
  test("returns the agreed room, playback, message and dedicated SSE contracts", () => {
    expect(result.created.status).toBe(201);
    expect(result.created.selfId).toBe(1);
    expect(result.created.videoId).toBe("partyvideo");
    expect(result.created.playback).toMatchObject({ revision: 1, position: 7, paused: false, playback_rate: 1.25 });
    expect(result.sse.hostStatus).toBe(200);
    expect(result.sse.hostSnapshot).toContain("event: party");
    expect(result.sse.hostSnapshot).toContain('"type":"snapshot"');
    expect(result.sse.friendSnapshot).toContain(`"self_id":${result.friendId}`);

    expect(result.playback.status).toBe(200);
    expect(result.playback.body.playback).toMatchObject({ revision: 2, position: 13, paused: false, playback_rate: 1.5 });
    expect(result.message).toEqual({
      status: 201,
      body: { message: expect.objectContaining({ body: "Oglądamy!", author: expect.objectContaining({ id: result.friendId }) }) },
    });
    expect(result.room).toEqual({
      status: 200,
      selfId: result.friendId,
      hostId: 1,
      participantIds: [1, result.friendId],
      messageBodies: ["Oglądamy!"],
      cacheControl: "private, no-store",
    });
  });

  test("enforces host/member/video/access rules and closes rooms when the opt-in is disabled", () => {
    expect(result.nonHostPlayback).toEqual({
      status: 403,
      body: { error: "only the host can control playback", code: "social_watch_party_host_only" },
    });
    expect(result.nonHostClose).toEqual({
      status: 403,
      body: { error: "only the host can close the room", code: "social_watch_party_host_only" },
    });
    expect(result.hostClose).toEqual({ status: 200, body: { ok: true } });
    expect(result.privateVideo.status).toBe(409);
    expect(result.privateVideo.body.code).toBe("social_watch_party_video_unsupported");
    expect(result.membersVideo.status).toBe(409);
    expect(result.membersVideo.body.code).toBe("social_watch_party_video_unsupported");
    expect(result.sse.disabledEvent).toContain('"type":"closed"');
    expect(result.sse.disabledEvent).toContain('"reason":"watch_together_disabled"');
    expect(result.sse.pluginDisabledEvent).toContain('"reason":"social_disabled"');
    expect(result.sse.resetEvent).toContain('"reason":"social_reset"');
    expect(result.disabledAccess).toEqual({
      status: 409,
      body: { error: "Watch together is disabled", code: "social_watch_together_disabled" },
    });
    expect(result.racingCreate).toEqual({
      status: 409,
      body: { error: "Watch together is disabled", code: "social_watch_together_disabled" },
      rooms: 0,
    });
    expect(result.resetRacingCreate).toEqual({
      status: 409,
      body: { error: "Watch together is disabled", code: "social_watch_together_disabled" },
      rooms: 0,
    });
    expect(result.authRevokedEvent).toContain('"type":"closed"');
    expect(result.authRevokedEvent).toContain('"reason":"access_revoked"');
    expect(result.diagnosticPaths).toEqual([
      "/social/watch-parties/:id/events",
      "/api/social/watch-parties/:id/messages",
      "/social/watch-parties",
      "/videos/room-bearer",
    ]);
    expect(result.roomsAfterDisable).toBe(0);
  });
});
