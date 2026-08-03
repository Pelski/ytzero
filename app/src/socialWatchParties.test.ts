import { describe, expect, test } from "bun:test";
import {
  SocialWatchPartyStore,
  WatchPartyError,
  type SocialWatchPartyEvent,
  type SocialWatchPartyProfile,
} from "./socialWatchParties";

function profile(id: number): SocialWatchPartyProfile {
  return {
    id,
    name: `Profile ${id}`,
    username: `Profile_${id}`,
    avatar: "",
    avatar_color: `#00000${id}`,
  };
}

function fixture(options: ConstructorParameters<typeof SocialWatchPartyStore>[0] = {}) {
  let now = 1_000;
  let id = 0;
  const profiles = new Map([[1, profile(1)], [2, profile(2)], [3, profile(3)]]);
  const videos = new Map([
    ["video", { video_id: "video", live_status: "none", is_private: 0, members_only: 0 }],
    ["live", { video_id: "live", live_status: "live", is_private: 0, members_only: 0 }],
    ["upcoming", { video_id: "upcoming", live_status: "upcoming", is_private: 0, members_only: 0 }],
    ["private", { video_id: "private", live_status: "none", is_private: 1, members_only: 0 }],
    ["members", { video_id: "members", live_status: "none", is_private: 0, members_only: 1 }],
  ]);
  const store = new SocialWatchPartyStore({
    now: () => now,
    id: () => `id-${++id}`,
    loadProfile: async (userId) => profiles.get(userId) ?? null,
    loadVideo: async (videoId) => videos.get(videoId) ?? null,
    ...options,
  });
  return {
    store,
    setNow(value: number) { now = value; },
    advance(ms: number) { now += ms; },
  };
}

function errorFrom(callback: () => unknown): WatchPartyError {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(WatchPartyError);
    return error as WatchPartyError;
  }
  throw new Error("expected WatchPartyError");
}

async function asyncErrorFrom(promise: Promise<unknown>): Promise<WatchPartyError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(WatchPartyError);
    return error as WatchPartyError;
  }
  throw new Error("expected WatchPartyError");
}

describe("Social watch party store", () => {
  test("creates bounded transient rooms only for playable stored videos", async () => {
    const { store } = fixture({ maxRooms: 1 });
    const room = await store.create(1, { video_id: "video", position: 12.5, paused: false, playback_rate: 1.25 });

    expect(room).toEqual({
      id: "id-1",
      video_id: "video",
      host: profile(1),
      participants: [profile(1)],
      messages: [],
      playback: { revision: 1, position: 12.5, paused: false, playback_rate: 1.25, updated_at: 1_000 },
      created_at: "1970-01-01T00:00:01.000Z",
    });
    expect(errorFrom(() => store.room("missing")).code).toBe("social_watch_party_not_found");

    const limited = await asyncErrorFrom(fixture({ maxRooms: 0 }).store.create(1, { video_id: "video" }));
    expect(limited.code).toBe("social_watch_party_room_limit");
    for (const videoId of ["live", "upcoming", "private", "members"]) {
      const unsupported = await asyncErrorFrom(fixture().store.create(1, { video_id: videoId }));
      expect(unsupported.code).toBe("social_watch_party_video_unsupported");
    }
  });

  test("rechecks global and per-host room limits after parallel lookups", async () => {
    let releaseGlobal!: () => void;
    let globalStarted = 0;
    let resolveGlobalStarted!: () => void;
    const globalGate = new Promise<void>((resolve) => { releaseGlobal = resolve; });
    const bothGlobalStarted = new Promise<void>((resolve) => { resolveGlobalStarted = resolve; });
    const globalStore = fixture({
      maxRooms: 1,
      loadVideo: async (videoId) => {
        globalStarted++;
        if (globalStarted === 2) resolveGlobalStarted();
        await globalGate;
        return { video_id: videoId, live_status: "none", is_private: 0, members_only: 0 };
      },
    }).store;
    const globalCreates = [
      globalStore.create(1, { video_id: "video" }),
      globalStore.create(2, { video_id: "video" }),
    ];
    await bothGlobalStarted;
    releaseGlobal();
    const globalResults = await Promise.allSettled(globalCreates);
    expect(globalResults.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect((globalResults.find(({ status }) => status === "rejected") as PromiseRejectedResult).reason.code).toBe("social_watch_party_room_limit");
    expect(globalStore.size).toBe(1);

    let releaseHost!: () => void;
    let hostStarted = 0;
    let resolveHostStarted!: () => void;
    const hostGate = new Promise<void>((resolve) => { releaseHost = resolve; });
    const allHostStarted = new Promise<void>((resolve) => { resolveHostStarted = resolve; });
    const hostStore = fixture({
      maxRooms: 10,
      loadVideo: async (videoId) => {
        hostStarted++;
        if (hostStarted === 4) resolveHostStarted();
        await hostGate;
        return { video_id: videoId, live_status: "none", is_private: 0, members_only: 0 };
      },
    }).store;
    const hostCreates = Array.from({ length: 4 }, () => hostStore.create(1, { video_id: "video" }));
    await allHostStarted;
    releaseHost();
    const hostResults = await Promise.allSettled(hostCreates);
    expect(hostResults.filter(({ status }) => status === "fulfilled")).toHaveLength(3);
    expect((hostResults.find(({ status }) => status === "rejected") as PromiseRejectedResult).reason.code).toBe("social_watch_party_host_room_limit");
    expect(hostStore.size).toBe(3);
  });

  test("counts multi-tab presence once and promotes the oldest online participant after host grace", async () => {
    const { store, advance } = fixture();
    const room = await store.create(1, { video_id: "video" });
    const hostEvents: SocialWatchPartyEvent[] = [];
    const guestEvents: SocialWatchPartyEvent[] = [];
    const hostTabOne = await store.connect(room.id, 1, (event) => hostEvents.push(event));
    const hostTabTwo = await store.connect(room.id, 1, (event) => hostEvents.push(event));
    const guest = await store.connect(room.id, 2, (event) => guestEvents.push(event));

    expect(store.room(room.id).participants.map(({ id }) => id)).toEqual([1, 2]);
    hostTabOne.disconnect();
    expect(store.room(room.id).participants.map(({ id }) => id)).toEqual([1, 2]);
    hostTabTwo.disconnect();
    expect(store.room(room.id).host.id).toBe(1);

    advance(29_999);
    store.sweep();
    expect(store.room(room.id).host.id).toBe(1);
    advance(1);
    store.sweep();
    expect(store.room(room.id).host.id).toBe(2);
    expect(store.room(room.id).participants.map(({ id }) => id)).toEqual([2]);
    expect(guestEvents.some((event) => event.type === "presence" && event.host.id === 2)).toBe(true);
    guest.disconnect();
  });

  test("caps each participant at five concurrent room connections", async () => {
    const { store } = fixture();
    const room = await store.create(1, { video_id: "video" });
    const connections = await Promise.all(Array.from({ length: 5 }, () => store.connect(room.id, 1, () => {})));
    const limited = await asyncErrorFrom(store.connect(room.id, 1, () => {}));
    expect(limited.code).toBe("social_watch_party_connection_limit");
    expect(store.room(room.id).participants.map(({ id }) => id)).toEqual([1]);

    connections[0]!.disconnect();
    const replacement = await store.connect(room.id, 1, () => {});
    replacement.disconnect();
    for (const connection of connections.slice(1)) connection.disconnect();
  });

  test("allows only the active host to publish monotonic, deduplicated playback revisions", async () => {
    const { store, setNow } = fixture();
    const room = await store.create(1, { video_id: "video" });
    const host = await store.connect(room.id, 1, () => {});
    const guest = await store.connect(room.id, 2, () => {});

    expect(errorFrom(() => store.updatePlayback(room.id, 2, { paused: false })).code).toBe("social_watch_party_host_only");
    expect(errorFrom(() => store.updatePlayback(room.id, 1, {
      position: 20,
      paused: false,
      expected_revision: 1,
      client_event_id: "incomplete",
    })).code).toBe("social_watch_party_invalid_playback");
    const updated = store.updatePlayback(room.id, 1, {
      position: 20,
      paused: false,
      playback_rate: 1,
      expected_revision: 1,
      client_event_id: "play-1",
    });
    expect(updated).toEqual({ revision: 2, position: 20, paused: false, playback_rate: 1, updated_at: 1_001 });

    setNow(900);
    expect(store.updatePlayback(room.id, 1, {
      position: 999,
      paused: false,
      playback_rate: 1,
      expected_revision: 1,
      client_event_id: "play-1",
    })).toEqual(updated);
    const conflict = errorFrom(() => store.updatePlayback(room.id, 1, {
      position: 21,
      paused: false,
      playback_rate: 1,
      expected_revision: 1,
      client_event_id: "play-2",
    }));
    expect(conflict.code).toBe("social_watch_party_revision_conflict");
    expect(conflict.details?.playback).toEqual(updated);
    expect(store.updatePlayback(room.id, 1, {
      position: 21,
      paused: false,
      playback_rate: 1,
      expected_revision: 2,
      client_event_id: "play-3",
    }).updated_at).toBe(1_002);

    host.disconnect();
    expect(errorFrom(() => store.updatePlayback(room.id, 1, { paused: true })).code).toBe("social_watch_party_not_joined");
    guest.disconnect();
  });

  test("rate-limits accepted playback updates to twenty per five seconds", async () => {
    const { store, advance } = fixture();
    const room = await store.create(1, { video_id: "video" });
    const host = await store.connect(room.id, 1, () => {});
    for (let index = 0; index < 20; index++) {
      const playback = store.updatePlayback(room.id, 1, {
        position: index,
        paused: false,
        playback_rate: 1,
        expected_revision: index + 1,
        client_event_id: `rate-${index}`,
      });
      expect(playback.revision).toBe(index + 2);
    }
    expect(errorFrom(() => store.updatePlayback(room.id, 1, {
      position: 20,
      paused: false,
      playback_rate: 1,
      expected_revision: 21,
      client_event_id: "rate-limited",
    })).code).toBe("social_watch_party_playback_rate_limited");

    advance(5_000);
    expect(store.updatePlayback(room.id, 1, {
      position: 20,
      paused: false,
      playback_rate: 1,
      expected_revision: 21,
      client_event_id: "after-window",
    }).revision).toBe(22);
    host.disconnect();
  });

  test("limits chat length and rate while retaining only the newest bounded messages", async () => {
    const { store, advance } = fixture({ maxMessages: 2, messageRateLimit: 2, messageRateWindowMs: 1_000 });
    const room = await store.create(1, { video_id: "video" });
    const host = await store.connect(room.id, 1, () => {});

    expect(store.addMessage(room.id, 1, "a".repeat(500)).sequence).toBe(1);
    expect(store.addMessage(room.id, 1, "second").sequence).toBe(2);
    expect(errorFrom(() => store.addMessage(room.id, 1, "too soon")).code).toBe("social_watch_party_message_rate_limited");
    advance(1_000);
    expect(store.addMessage(room.id, 1, "third").sequence).toBe(3);
    expect(store.room(room.id).messages.map(({ sequence }) => sequence)).toEqual([2, 3]);
    expect(errorFrom(() => store.addMessage(room.id, 1, "a".repeat(501))).code).toBe("social_watch_party_invalid_message");
    host.disconnect();
  });

  test("expires rooms, emits closure, and releases all transient content", async () => {
    const { store, advance } = fixture({ roomTtlMs: 100 });
    const room = await store.create(1, { video_id: "video" });
    const events: SocialWatchPartyEvent[] = [];
    await store.connect(room.id, 1, (event) => events.push(event));
    store.addMessage(room.id, 1, "temporary");

    advance(100);
    store.sweep();
    expect(store.size).toBe(0);
    expect(events.at(-1)).toEqual({ type: "closed", reason: "expired" });
    expect(errorFrom(() => store.room(room.id)).code).toBe("social_watch_party_not_found");
  });
});
