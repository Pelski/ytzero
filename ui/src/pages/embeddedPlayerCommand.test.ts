import { describe, expect, test } from "bun:test";
import { applyEmbeddedPlayerCommand } from "./embeddedPlayerCommand";

describe("embedded player command routing", () => {
  test("uses the extension bridge only for an embedded YouTube player", async () => {
    const calls: string[] = [];
    const result = await applyEmbeddedPlayerCommand({
      audioActive: false,
      command: "toggle-play",
      fallback: () => calls.push("fallback"),
      playerKind: "youtube",
      sendCommand: async (_videoId, command) => {
        calls.push(command);
        return {};
      },
      videoId: "abcdefghijk",
    });

    expect(result).toBe("bridge");
    expect(calls).toEqual(["toggle-play"]);
  });

  for (const playerKind of ["local", "stream", "direct"] as const) {
    test(`keeps ${playerKind} on its native player path`, async () => {
      const calls: string[] = [];
      const result = await applyEmbeddedPlayerCommand({
        audioActive: false,
        command: "toggle-play",
        fallback: () => calls.push("fallback"),
        playerKind,
        sendCommand: async () => {
          calls.push("bridge");
          return {};
        },
        videoId: "abcdefghijk",
      });

      expect(result).toBe("fallback");
      expect(calls).toEqual(["fallback"]);
    });
  }

  test("keeps audio mode on its native player path", async () => {
    const calls: string[] = [];
    const result = await applyEmbeddedPlayerCommand({
      audioActive: true,
      command: "seek-by",
      fallback: () => calls.push("fallback"),
      playerKind: "youtube",
      sendCommand: async () => {
        calls.push("bridge");
        return {};
      },
      videoId: "abcdefghijk",
    });

    expect(result).toBe("fallback");
    expect(calls).toEqual(["fallback"]);
  });
});
