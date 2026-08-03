const { db, setSetting } = await import("../src/db");
const { resetPluginState, setPluginEnabled, setPluginSettings } = await import("../src/plugins");

db.prepare("UPDATE users SET username='Default' WHERE id=1").run();
const friend = db.prepare(`
  INSERT INTO users(name,username,avatar_color,sort_order,portable_uuid)
  VALUES('Friend','Friend','#3366ff',1,?) RETURNING id
`).get(crypto.randomUUID()) as { id: number };
db.prepare("INSERT INTO channels(channel_id,title,url) VALUES('UCparty','Party channel','https://youtube.com/channel/UCparty')").run();
db.prepare("INSERT INTO videos(video_id,channel_id,title,thumbnail) VALUES('partyvideo','UCparty','Party video','thumb.jpg')").run();
db.prepare("INSERT INTO videos(video_id,channel_id,title,thumbnail,is_private) VALUES('privateparty','UCparty','Private party','thumb.jpg',1)").run();
db.prepare("INSERT INTO videos(video_id,channel_id,title,thumbnail,members_only) VALUES('membersparty','UCparty','Members party','thumb.jpg',1)").run();

await setPluginEnabled("social", true);
await setPluginSettings(1, "social", { watch_together_enabled: 1 });

const { api, revalidateCurrentRequestUser } = await import("../src/routes");
const { diagnosticRequestPath } = await import("../src/requestDiagnostics");
const { SocialWatchPartyStore, socialWatchPartyStore } = await import("../src/socialWatchParties");
const { registerSocialWatchPartyRoutes } = await import("../src/routes/socialWatchPartyRoutes");
const { createSession, destroySession } = await import("../src/auth");
const { Hono } = await import("hono");

function request(profileId: number, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cookie", `ytzero_profile=${profileId}`);
  if (init.body) headers.set("Content-Type", "application/json");
  return api.request(`http://localhost${path}`, { ...init, headers });
}

async function jsonRequest(profileId: number, path: string, method: string, body?: unknown) {
  const response = await request(profileId, path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as any };
}

async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, pattern: string): Promise<string> {
  let output = "";
  while (!output.includes(pattern)) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const next = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out waiting for SSE payload: ${pattern}`)), 2_000);
      }),
    ]);
    if (timer) clearTimeout(timer);
    if (next.done) break;
    output += new TextDecoder().decode(next.value);
  }
  return output;
}

async function openEvents(profileId: number, roomId: string) {
  const response = await request(profileId, `/social/watch-parties/${roomId}/events`);
  if (!response.body) throw new Error("SSE response has no body");
  const reader = response.body.getReader();
  const snapshot = await readUntil(reader, '"type":"snapshot"');
  return { status: response.status, reader, snapshot };
}

const created = await jsonRequest(1, "/social/watch-parties", "POST", {
  video_id: "partyvideo",
  playback: { position: 7, paused: false, playback_rate: 1.25 },
});
const roomId = created.body.room.id as string;
const hostEvents = await openEvents(1, roomId);
const friendEvents = await openEvents(friend.id, roomId);

const nonHostPlayback = await jsonRequest(friend.id, `/social/watch-parties/${roomId}/playback`, "PATCH", { paused: false });
const playback = await jsonRequest(1, `/social/watch-parties/${roomId}/playback`, "PUT", {
  position: 13,
  paused: false,
  playback_rate: 1.5,
  expected_revision: 1,
  client_event_id: "route-playback-1",
});
const message = await jsonRequest(friend.id, `/social/watch-parties/${roomId}/messages`, "POST", { body: "Oglądamy!" });
const roomResponse = await request(friend.id, `/social/watch-parties/${roomId}`);
const roomCacheControl = roomResponse.headers.get("Cache-Control");
const room = { status: roomResponse.status, body: await roomResponse.json() as any };
const nonHostClose = await jsonRequest(friend.id, `/social/watch-parties/${roomId}`, "DELETE");
const hostClose = await jsonRequest(1, `/social/watch-parties/${roomId}`, "DELETE");
await hostEvents.reader.cancel();
await friendEvents.reader.cancel();

const privateVideo = await jsonRequest(1, "/social/watch-parties", "POST", { video_id: "privateparty" });
const membersVideo = await jsonRequest(1, "/social/watch-parties", "POST", { video_id: "membersparty" });
const second = await jsonRequest(1, "/social/watch-parties", "POST", { video_id: "partyvideo" });
const secondEvents = await openEvents(1, second.body.room.id);
await setPluginSettings(1, "social", { watch_together_enabled: 0 });
const disabledEvent = await readUntil(secondEvents.reader, '"type":"closed"');
await secondEvents.reader.cancel();
const disabledAccess = await jsonRequest(1, `/social/watch-parties/${second.body.room.id}`, "GET");

await setPluginSettings(1, "social", { watch_together_enabled: 1 });
const third = await jsonRequest(1, "/social/watch-parties", "POST", { video_id: "partyvideo" });
const thirdEvents = await openEvents(1, third.body.room.id);
await setPluginEnabled("social", false);
const pluginDisabledEvent = await readUntil(thirdEvents.reader, '"type":"closed"');
await thirdEvents.reader.cancel();

await setPluginEnabled("social", true);
await setPluginSettings(1, "social", { watch_together_enabled: 1 });
const fourth = await jsonRequest(1, "/social/watch-parties", "POST", { video_id: "partyvideo" });
const fourthEvents = await openEvents(1, fourth.body.room.id);
await resetPluginState(1, "social");
const resetEvent = await readUntil(fourthEvents.reader, '"type":"closed"');
await fourthEvents.reader.cancel();

// Disable the feature while create() is suspended in asynchronous video I/O.
// The post-create gate must remove the room that missed closeAll's earlier pass.
await setPluginSettings(1, "social", { watch_together_enabled: 1 });
let releaseRaceCreate!: () => void;
let markRaceCreateStarted!: () => void;
const raceCreateGate = new Promise<void>((resolve) => { releaseRaceCreate = resolve; });
const raceCreateStarted = new Promise<void>((resolve) => { markRaceCreateStarted = resolve; });
const raceStore = new SocialWatchPartyStore({
  loadVideo: async (videoId) => {
    markRaceCreateStarted();
    await raceCreateGate;
    return { video_id: videoId, live_status: "none", is_private: 0, members_only: 0 };
  },
});
const raceApi = new Hono<any>();
registerSocialWatchPartyRoutes(raceApi, {
  currentUserId: () => 1,
  isAdmin: () => false,
  revalidateCurrentUser: async () => true,
}, { store: raceStore, heartbeatMs: 10 });
const racingCreatePromise = raceApi.request("http://localhost/social/watch-parties", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ video_id: "partyvideo", playback: { position: 3, paused: true, playback_rate: 1 } }),
});
await raceCreateStarted;
await setPluginSettings(1, "social", { watch_together_enabled: 0 });
releaseRaceCreate();
const racingCreateResponse = await racingCreatePromise;
const racingCreate = { status: racingCreateResponse.status, body: await racingCreateResponse.json() as any, rooms: raceStore.size };

await setPluginSettings(1, "social", { watch_together_enabled: 1 });
let releaseResetCreate!: () => void;
let markResetCreateStarted!: () => void;
const resetCreateGate = new Promise<void>((resolve) => { releaseResetCreate = resolve; });
const resetCreateStarted = new Promise<void>((resolve) => { markResetCreateStarted = resolve; });
const resetRaceStore = new SocialWatchPartyStore({
  loadVideo: async (videoId) => {
    markResetCreateStarted();
    await resetCreateGate;
    return { video_id: videoId, live_status: "none", is_private: 0, members_only: 0 };
  },
});
const resetRaceApi = new Hono<any>();
registerSocialWatchPartyRoutes(resetRaceApi, {
  currentUserId: () => 1,
  isAdmin: () => false,
  revalidateCurrentUser: async () => true,
}, { store: resetRaceStore, heartbeatMs: 10 });
const resetRacingCreatePromise = resetRaceApi.request("http://localhost/social/watch-parties", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ video_id: "partyvideo", playback: { position: 4, paused: true, playback_rate: 1 } }),
});
await resetCreateStarted;
await resetPluginState(1, "social");
releaseResetCreate();
const resetRacingCreateResponse = await resetRacingCreatePromise;
const resetRacingCreate = {
  status: resetRacingCreateResponse.status,
  body: await resetRacingCreateResponse.json() as any,
  rooms: resetRaceStore.size,
};

// A short-heartbeat isolated router exercises the same revalidation callback
// wired into routes.ts, then revokes the backing DB session mid-stream.
await setPluginSettings(1, "social", { watch_together_enabled: 1 });
await setSetting("auth_method", "shared");
const token = await createSession(null, "account");
const authStore = new SocialWatchPartyStore();
const authApi = new Hono<any>();
registerSocialWatchPartyRoutes(authApi, {
  currentUserId: () => 1,
  isAdmin: () => false,
  revalidateCurrentUser: revalidateCurrentRequestUser,
}, { store: authStore, heartbeatMs: 10 });
const authCookie = `ytzero_session=${token}; ytzero_profile=1`;
const authCreatedResponse = await authApi.request("http://localhost/social/watch-parties", {
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: authCookie },
  body: JSON.stringify({ video_id: "partyvideo", playback: { position: 0, paused: true, playback_rate: 1 } }),
});
const authCreated = await authCreatedResponse.json() as any;
const authEventsResponse = await authApi.request(`http://localhost/social/watch-parties/${authCreated.room.id}/events`, {
  headers: { Cookie: authCookie },
});
if (!authEventsResponse.body) throw new Error("auth SSE response has no body");
const authReader = authEventsResponse.body.getReader();
await readUntil(authReader, '"type":"snapshot"');
await destroySession(token);
const authRevokedEvent = await readUntil(authReader, '"type":"closed"');
await authReader.cancel();
await setSetting("auth_method", "none");

console.log("RESULT " + JSON.stringify({
  friendId: friend.id,
  created: {
    status: created.status,
    selfId: created.body.self_id,
    videoId: created.body.room.video_id,
    playback: created.body.room.playback,
  },
  sse: {
    hostStatus: hostEvents.status,
    hostSnapshot: hostEvents.snapshot,
    friendSnapshot: friendEvents.snapshot,
    disabledEvent,
    pluginDisabledEvent,
    resetEvent,
  },
  nonHostPlayback,
  playback,
  message,
  room: {
    status: room.status,
    selfId: room.body.self_id,
    hostId: room.body.room.host.id,
    participantIds: room.body.room.participants.map((profile: { id: number }) => profile.id),
    messageBodies: room.body.room.messages.map((entry: { body: string }) => entry.body),
    cacheControl: roomCacheControl,
  },
  nonHostClose,
  hostClose,
  privateVideo,
  membersVideo,
  disabledAccess,
  racingCreate,
  resetRacingCreate,
  authRevokedEvent,
  diagnosticPaths: [
    diagnosticRequestPath("/social/watch-parties/room-bearer/events"),
    diagnosticRequestPath("/api/social/watch-parties/room-bearer/messages"),
    diagnosticRequestPath("/social/watch-parties"),
    diagnosticRequestPath("/videos/room-bearer"),
  ],
  roomsAfterDisable: socialWatchPartyStore.size,
}));

socialWatchPartyStore.closeAll("test_complete");
raceStore.closeAll("test_complete");
resetRaceStore.closeAll("test_complete");
authStore.closeAll("test_complete");
db.close();
