import { afterEach, describe, expect, test } from "bun:test";
import { resolveChannelId } from "./youtube";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("channel resolution errors", () => {
  test("uses an English error when a channel page cannot be fetched", async () => {
    globalThis.fetch = (async () => new Response("Not found", { status: 404 })) as unknown as typeof fetch;

    await expect(resolveChannelId("@BaaliSinbad")).rejects.toThrow(
      "Failed to fetch channel page (404)",
    );
  });
});
