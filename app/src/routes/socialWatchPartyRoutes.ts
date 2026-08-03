import type { Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { assertWatchTogetherAccess, SocialError } from "../social";
import {
  socialWatchPartyStore,
  SocialWatchPartyStore,
  WatchPartyError,
  type SocialWatchPartyEvent,
} from "../socialWatchParties";

type ApiEnvironment = { Variables: { userId: number; sessionAdmin?: boolean; profileAdmin?: boolean } };
type Api = Hono<ApiEnvironment>;
type ApiContext = Context<ApiEnvironment>;

export interface SocialWatchPartyRouteOptions {
  store?: SocialWatchPartyStore;
  heartbeatMs?: number;
}

function watchPartyFailure(c: any, error: unknown) {
  if (error instanceof SocialError) return c.json({ error: error.message, code: error.code }, error.status);
  if (error instanceof WatchPartyError) {
    return c.json({ error: error.message, code: error.code, ...(error.details ?? {}) }, error.status);
  }
  throw error;
}

function playbackInput(body: any) {
  const playback = body?.playback && typeof body.playback === "object" ? body.playback : body;
  return {
    position: playback?.position,
    paused: playback?.paused,
    playback_rate: playback?.playback_rate,
    expected_revision: body?.expected_revision ?? playback?.expected_revision,
    client_event_id: body?.client_event_id ?? playback?.client_event_id,
  };
}

function createInput(body: any) {
  const playback = body?.playback && typeof body.playback === "object" ? body.playback : body;
  return {
    video_id: body?.video_id,
    position: playback?.position,
    paused: playback?.paused,
    playback_rate: playback?.playback_rate,
  };
}

export function registerSocialWatchPartyRoutes(
  api: Api,
  access: {
    isAdmin: (context: ApiContext) => boolean;
    currentUserId: (context: ApiContext) => number;
    revalidateCurrentUser: (context: ApiContext, expectedUserId: number) => Promise<boolean>;
  },
  options: SocialWatchPartyRouteOptions = {},
): void {
  const { isAdmin, currentUserId, revalidateCurrentUser } = access;
  const store = options.store ?? socialWatchPartyStore;
  const heartbeatMs = options.heartbeatMs ?? 15_000;

  api.post("/social/watch-parties", async (c) => {
    try {
      const userId = currentUserId(c);
      await assertWatchTogetherAccess(userId);
      const body = await c.req.json().catch(() => ({}));
      const room = await store.create(userId, createInput(body));
      try {
        // Closing the race where Social/Watch together is disabled while the
        // asynchronous profile/video lookup in create() is still in flight.
        await assertWatchTogetherAccess(userId);
      } catch (error) {
        try { store.close(room.id, userId, false, "access_revoked"); } catch {}
        throw error;
      }
      return c.json({ room, self_id: userId }, 201);
    } catch (error) {
      return watchPartyFailure(c, error);
    }
  });

  api.get("/social/watch-parties/:id", async (c) => {
    try {
      const userId = currentUserId(c);
      await assertWatchTogetherAccess(userId);
      c.header("Cache-Control", "private, no-store");
      return c.json({ room: store.room(c.req.param("id")), self_id: userId });
    } catch (error) {
      return watchPartyFailure(c, error);
    }
  });

  api.get("/social/watch-parties/:id/events", async (c) => {
    let connection: Awaited<ReturnType<SocialWatchPartyStore["connect"]>> | null = null;
    try {
      const userId = currentUserId(c);
      await assertWatchTogetherAccess(userId);

      const pending: SocialWatchPartyEvent[] = [];
      let deliver = (event: SocialWatchPartyEvent): void => { pending.push(event); };
      connection = await store.connect(c.req.param("id"), userId, (event) => deliver(event));

      c.header("X-Accel-Buffering", "no");
      c.header("Cache-Control", "no-cache, no-store, no-transform");
      return streamSSE(c, async (stream) => {
        let stopped = false;
        let eventId = 1;
        let heartbeat: ReturnType<typeof setInterval> | null = null;
        let resolveDone: (() => void) | null = null;
        let writes = Promise.resolve();
        const done = new Promise<void>((resolve) => { resolveDone = resolve; });

        const stop = () => {
          if (stopped) return;
          stopped = true;
          if (heartbeat) clearInterval(heartbeat);
          connection?.disconnect();
          resolveDone?.();
        };
        const enqueue = (event: string, value: unknown) => {
          if (stopped) return;
          writes = writes
            .then(() => stream.writeSSE({ event, data: JSON.stringify(value), id: String(eventId++) }))
            .catch(() => stop());
        };
        const enqueueParty = (event: SocialWatchPartyEvent) => {
          enqueue("party", event);
          if (event.type === "closed") void writes.finally(stop);
        };

        deliver = enqueueParty;
        enqueue("party", { type: "snapshot", room: connection!.room, self_id: userId });
        for (const event of pending) enqueueParty(event);

        let checkingAccess = false;
        heartbeat = setInterval(async () => {
          if (checkingAccess || stopped) return;
          checkingAccess = true;
          try {
            if (!await revalidateCurrentUser(c, userId)) throw new Error("authentication changed");
            await assertWatchTogetherAccess(userId);
            connection?.touch();
            enqueue("ping", { at: Date.now() });
          } catch {
            enqueueParty({ type: "closed", reason: "access_revoked" });
          } finally {
            checkingAccess = false;
          }
        }, heartbeatMs);
        stream.onAbort(stop);
        await done;
      });
    } catch (error) {
      connection?.disconnect();
      return watchPartyFailure(c, error);
    }
  });

  const updatePlayback = async (c: any) => {
    try {
      const userId = currentUserId(c);
      await assertWatchTogetherAccess(userId);
      const body = await c.req.json().catch(() => ({}));
      const playback = store.updatePlayback(c.req.param("id"), userId, playbackInput(body));
      return c.json({ playback });
    } catch (error) {
      return watchPartyFailure(c, error);
    }
  };
  api.patch("/social/watch-parties/:id/playback", updatePlayback);
  api.put("/social/watch-parties/:id/playback", updatePlayback);

  api.post("/social/watch-parties/:id/messages", async (c) => {
    try {
      const userId = currentUserId(c);
      await assertWatchTogetherAccess(userId);
      const body = await c.req.json().catch(() => ({}));
      return c.json({ message: store.addMessage(c.req.param("id"), userId, body.body) }, 201);
    } catch (error) {
      return watchPartyFailure(c, error);
    }
  });

  api.delete("/social/watch-parties/:id", async (c) => {
    try {
      const userId = currentUserId(c);
      await assertWatchTogetherAccess(userId);
      store.close(c.req.param("id"), userId, isAdmin(c));
      return c.json({ ok: true });
    } catch (error) {
      return watchPartyFailure(c, error);
    }
  });
}
