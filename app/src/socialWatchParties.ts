import { database } from "./database";
import { profileUsername } from "./profileCredentials";

export const WATCH_PARTY_MESSAGE_LIMIT = 500;
export const WATCH_PARTY_DEFAULT_MAX_ROOMS = 64;
export const WATCH_PARTY_DEFAULT_MAX_ROOMS_PER_HOST = 3;
export const WATCH_PARTY_DEFAULT_MAX_MESSAGES = 100;
export const WATCH_PARTY_DEFAULT_MAX_PARTICIPANTS = 32;
export const WATCH_PARTY_DEFAULT_MAX_CONNECTIONS_PER_PARTICIPANT = 5;
export const WATCH_PARTY_DEFAULT_TTL_MS = 6 * 60 * 60 * 1_000;
export const WATCH_PARTY_DEFAULT_HOST_GRACE_MS = 30_000;
export const WATCH_PARTY_DEFAULT_OFFLINE_MEMBER_TTL_MS = 60_000;
export const WATCH_PARTY_MESSAGE_RATE_LIMIT = 5;
export const WATCH_PARTY_MESSAGE_RATE_WINDOW_MS = 10_000;
export const WATCH_PARTY_PLAYBACK_RATE_LIMIT = 20;
export const WATCH_PARTY_PLAYBACK_RATE_WINDOW_MS = 5_000;

export interface SocialWatchPartyProfile {
  id: number;
  name: string;
  username: string;
  avatar: string;
  avatar_color: string;
}

export interface SocialWatchPartyPlayback {
  revision: number;
  position: number;
  paused: boolean;
  playback_rate: number;
  updated_at: number;
}

export interface SocialWatchPartyMessage {
  id: string;
  sequence: number;
  body: string;
  created_at: string;
  author: SocialWatchPartyProfile;
}

export interface SocialWatchPartyRoom {
  id: string;
  video_id: string;
  host: SocialWatchPartyProfile;
  participants: SocialWatchPartyProfile[];
  messages: SocialWatchPartyMessage[];
  playback: SocialWatchPartyPlayback;
  created_at: string;
}

export type SocialWatchPartyEvent =
  | { type: "playback"; playback: SocialWatchPartyPlayback }
  | { type: "message"; message: SocialWatchPartyMessage }
  | { type: "presence"; host: SocialWatchPartyProfile; participants: SocialWatchPartyProfile[] }
  | { type: "closed"; reason: string };

interface WatchPartyVideo {
  video_id: string;
  live_status: string;
  is_private: number;
  members_only: number;
}

interface MemberState {
  profile: SocialWatchPartyProfile;
  joinedOrder: number;
  connections: Set<string>;
  offlineAt: number | null;
  provisionalUntil: number;
}

interface SubscriberState {
  userId: number;
  listener: (event: SocialWatchPartyEvent) => void;
}

interface RoomState {
  id: string;
  videoId: string;
  createdByUserId: number;
  hostUserId: number;
  createdAt: number;
  lastActivityAt: number;
  playback: SocialWatchPartyPlayback;
  messages: SocialWatchPartyMessage[];
  messageSequence: number;
  memberSequence: number;
  members: Map<number, MemberState>;
  subscribers: Map<string, SubscriberState>;
  messageRate: Map<number, number[]>;
  playbackRate: Map<number, number[]>;
  playbackReceipts: Map<string, SocialWatchPartyPlayback>;
}

export interface SocialWatchPartyStoreOptions {
  now?: () => number;
  id?: () => string;
  loadProfile?: (userId: number) => Promise<SocialWatchPartyProfile | null>;
  loadVideo?: (videoId: string) => Promise<WatchPartyVideo | null>;
  maxRooms?: number;
  maxRoomsPerHost?: number;
  maxMessages?: number;
  maxParticipants?: number;
  maxConnectionsPerParticipant?: number;
  roomTtlMs?: number;
  hostGraceMs?: number;
  offlineMemberTtlMs?: number;
  messageRateLimit?: number;
  messageRateWindowMs?: number;
  playbackRateLimit?: number;
  playbackRateWindowMs?: number;
  autoSweep?: boolean;
  sweepIntervalMs?: number;
}

export class WatchPartyError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "social_watch_party_error",
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

function cloneProfile(profile: SocialWatchPartyProfile): SocialWatchPartyProfile {
  return { ...profile };
}

function clonePlayback(playback: SocialWatchPartyPlayback): SocialWatchPartyPlayback {
  return { ...playback };
}

function cloneMessage(message: SocialWatchPartyMessage): SocialWatchPartyMessage {
  return { ...message, author: cloneProfile(message.author) };
}

async function loadStoredProfile(userId: number): Promise<SocialWatchPartyProfile | null> {
  const row = await database.prepare("SELECT id,name,username,avatar,avatar_color FROM users WHERE id=?")
    .get(userId) as { id: number; name: string; username: string | null; avatar: string; avatar_color: string } | null;
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    username: row.username || profileUsername(row.name, row.id),
    avatar: row.avatar ? `/api/profiles/${row.id}/avatar?v=${encodeURIComponent(row.avatar)}` : "",
    avatar_color: row.avatar_color,
  };
}

async function loadStoredVideo(videoId: string): Promise<WatchPartyVideo | null> {
  return database.prepare("SELECT video_id,live_status,is_private,members_only FROM videos WHERE video_id=?")
    .get(videoId) as Promise<WatchPartyVideo | null>;
}

function normalizedPosition(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  const position = Number(value);
  if (!Number.isFinite(position) || position < 0 || position > 7 * 24 * 60 * 60) {
    throw new WatchPartyError("invalid playback position", 400, "social_watch_party_invalid_playback");
  }
  return position;
}

function normalizedRate(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate < 0.25 || rate > 4) {
    throw new WatchPartyError("invalid playback rate", 400, "social_watch_party_invalid_playback");
  }
  return rate;
}

function normalizedPaused(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new WatchPartyError("invalid paused state", 400, "social_watch_party_invalid_playback");
  return value;
}

function normalizedMessageBody(value: unknown): string {
  if (typeof value !== "string") throw new WatchPartyError("message must be a string", 400, "social_watch_party_invalid_message");
  const body = value.replace(/\r\n?/g, "\n").trim();
  if (!body) throw new WatchPartyError("message is required", 400, "social_watch_party_invalid_message");
  if (body.length > WATCH_PARTY_MESSAGE_LIMIT) {
    throw new WatchPartyError(`message is too long (maximum ${WATCH_PARTY_MESSAGE_LIMIT} characters)`, 400, "social_watch_party_invalid_message");
  }
  return body;
}

export class SocialWatchPartyStore {
  readonly #rooms = new Map<string, RoomState>();
  readonly #now: () => number;
  readonly #id: () => string;
  readonly #loadProfile: (userId: number) => Promise<SocialWatchPartyProfile | null>;
  readonly #loadVideo: (videoId: string) => Promise<WatchPartyVideo | null>;
  readonly #maxRooms: number;
  readonly #maxRoomsPerHost: number;
  readonly #maxMessages: number;
  readonly #maxParticipants: number;
  readonly #maxConnectionsPerParticipant: number;
  readonly #roomTtlMs: number;
  readonly #hostGraceMs: number;
  readonly #offlineMemberTtlMs: number;
  readonly #messageRateLimit: number;
  readonly #messageRateWindowMs: number;
  readonly #playbackRateLimit: number;
  readonly #playbackRateWindowMs: number;
  readonly #sweepTimer: ReturnType<typeof setInterval> | null;

  constructor(options: SocialWatchPartyStoreOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#id = options.id ?? (() => crypto.randomUUID());
    this.#loadProfile = options.loadProfile ?? loadStoredProfile;
    this.#loadVideo = options.loadVideo ?? loadStoredVideo;
    this.#maxRooms = options.maxRooms ?? WATCH_PARTY_DEFAULT_MAX_ROOMS;
    this.#maxRoomsPerHost = options.maxRoomsPerHost ?? WATCH_PARTY_DEFAULT_MAX_ROOMS_PER_HOST;
    this.#maxMessages = options.maxMessages ?? WATCH_PARTY_DEFAULT_MAX_MESSAGES;
    this.#maxParticipants = options.maxParticipants ?? WATCH_PARTY_DEFAULT_MAX_PARTICIPANTS;
    this.#maxConnectionsPerParticipant = options.maxConnectionsPerParticipant ?? WATCH_PARTY_DEFAULT_MAX_CONNECTIONS_PER_PARTICIPANT;
    this.#roomTtlMs = options.roomTtlMs ?? WATCH_PARTY_DEFAULT_TTL_MS;
    this.#hostGraceMs = options.hostGraceMs ?? WATCH_PARTY_DEFAULT_HOST_GRACE_MS;
    this.#offlineMemberTtlMs = options.offlineMemberTtlMs ?? WATCH_PARTY_DEFAULT_OFFLINE_MEMBER_TTL_MS;
    this.#messageRateLimit = options.messageRateLimit ?? WATCH_PARTY_MESSAGE_RATE_LIMIT;
    this.#messageRateWindowMs = options.messageRateWindowMs ?? WATCH_PARTY_MESSAGE_RATE_WINDOW_MS;
    this.#playbackRateLimit = options.playbackRateLimit ?? WATCH_PARTY_PLAYBACK_RATE_LIMIT;
    this.#playbackRateWindowMs = options.playbackRateWindowMs ?? WATCH_PARTY_PLAYBACK_RATE_WINDOW_MS;
    this.#sweepTimer = options.autoSweep ? setInterval(() => this.sweep(), options.sweepIntervalMs ?? 1_000) : null;
    this.#sweepTimer?.unref?.();
  }

  get size(): number {
    return this.#rooms.size;
  }

  dispose(): void {
    if (this.#sweepTimer) clearInterval(this.#sweepTimer);
    this.closeAll("disposed");
  }

  async create(userId: number, input: { video_id?: unknown; position?: unknown; paused?: unknown; playback_rate?: unknown }): Promise<SocialWatchPartyRoom> {
    this.sweep();
    this.#assertRoomCapacity(userId);
    const videoId = typeof input.video_id === "string" ? input.video_id.trim() : "";
    if (!videoId) throw new WatchPartyError("video is required", 400, "social_watch_party_invalid_video");
    const [profile, video] = await Promise.all([this.#loadProfile(userId), this.#loadVideo(videoId)]);
    if (!profile) throw new WatchPartyError("profile not found", 404, "social_watch_party_profile_not_found");
    if (!video) throw new WatchPartyError("video not found", 404, "social_watch_party_video_not_found");
    if (video.is_private === 1 || video.members_only === 1 || video.live_status === "live" || video.live_status === "upcoming") {
      throw new WatchPartyError("video is not available for Watch together", 409, "social_watch_party_video_unsupported");
    }

    // Profile/video lookup is asynchronous. Re-check both caps after it so
    // concurrent creates cannot all pass a stale capacity snapshot.
    this.sweep();
    this.#assertRoomCapacity(userId);

    const now = this.#now();
    const roomId = this.#id();
    const playback: SocialWatchPartyPlayback = {
      revision: 1,
      position: normalizedPosition(input.position, 0),
      paused: normalizedPaused(input.paused, true),
      playback_rate: normalizedRate(input.playback_rate, 1),
      updated_at: now,
    };
    const host: MemberState = {
      profile: cloneProfile(profile),
      joinedOrder: 1,
      connections: new Set(),
      offlineAt: now,
      provisionalUntil: now + this.#hostGraceMs,
    };
    const room: RoomState = {
      id: roomId,
      videoId,
      createdByUserId: userId,
      hostUserId: userId,
      createdAt: now,
      lastActivityAt: now,
      playback,
      messages: [],
      messageSequence: 0,
      memberSequence: 1,
      members: new Map([[userId, host]]),
      subscribers: new Map(),
      messageRate: new Map(),
      playbackRate: new Map(),
      playbackReceipts: new Map(),
    };
    this.#rooms.set(roomId, room);
    return this.#serializeRoom(room, now);
  }

  room(roomId: string): SocialWatchPartyRoom {
    this.sweep();
    return this.#serializeRoom(this.#room(roomId), this.#now());
  }

  async connect(roomId: string, userId: number, listener: (event: SocialWatchPartyEvent) => void): Promise<{
    connection_id: string;
    room: SocialWatchPartyRoom;
    disconnect: () => void;
    touch: () => void;
  }> {
    this.sweep();
    const profile = await this.#loadProfile(userId);
    if (!profile) throw new WatchPartyError("profile not found", 404, "social_watch_party_profile_not_found");
    const room = this.#room(roomId);
    const now = this.#now();
    let member = room.members.get(userId);
    const becameOnline = !member || !this.#memberOnline(member, now);
    if (!member) {
      if (room.members.size >= this.#maxParticipants) {
        throw new WatchPartyError("watch room is full", 409, "social_watch_party_full");
      }
      member = {
        profile: cloneProfile(profile),
        joinedOrder: ++room.memberSequence,
        connections: new Set(),
        offlineAt: null,
        provisionalUntil: 0,
      };
      room.members.set(userId, member);
    } else {
      member.profile = cloneProfile(profile);
    }
    if (member.connections.size >= this.#maxConnectionsPerParticipant) {
      throw new WatchPartyError("too many watch room connections", 429, "social_watch_party_connection_limit");
    }
    const connectionId = this.#id();
    member.connections.add(connectionId);
    member.offlineAt = null;
    member.provisionalUntil = 0;
    room.lastActivityAt = now;
    if (becameOnline) this.#emitPresence(room, connectionId);
    room.subscribers.set(connectionId, { userId, listener });
    const snapshot = this.#serializeRoom(room, now);
    let connected = true;
    return {
      connection_id: connectionId,
      room: snapshot,
      disconnect: () => {
        if (!connected) return;
        connected = false;
        this.#disconnect(roomId, connectionId);
      },
      touch: () => {
        if (!connected) return;
        const current = this.#rooms.get(roomId);
        if (current?.subscribers.has(connectionId)) current.lastActivityAt = this.#now();
      },
    };
  }

  updatePlayback(roomId: string, userId: number, input: {
    position?: unknown;
    paused?: unknown;
    playback_rate?: unknown;
    expected_revision?: unknown;
    client_event_id?: unknown;
  }): SocialWatchPartyPlayback {
    this.sweep();
    const room = this.#room(roomId);
    this.#member(room, userId);
    if (room.hostUserId !== userId) throw new WatchPartyError("only the host can control playback", 403, "social_watch_party_host_only");

    if (
      input.position === undefined
      || input.paused === undefined
      || input.playback_rate === undefined
      || input.expected_revision === undefined
      || input.client_event_id === undefined
    ) {
      throw new WatchPartyError("complete playback state, expected revision and client event id are required", 400, "social_watch_party_invalid_playback");
    }
    const position = normalizedPosition(input.position, room.playback.position);
    const paused = normalizedPaused(input.paused, room.playback.paused);
    const playbackRate = normalizedRate(input.playback_rate, room.playback.playback_rate);

    if (typeof input.client_event_id !== "string" || !input.client_event_id.trim() || input.client_event_id.length > 100) {
      throw new WatchPartyError("invalid client event id", 400, "social_watch_party_invalid_playback");
    }
    const clientEventId = `${userId}:${input.client_event_id.trim()}`;
    const receipt = room.playbackReceipts.get(clientEventId);
    if (receipt) return clonePlayback(receipt);

    if (typeof input.expected_revision !== "number" || !Number.isInteger(input.expected_revision) || input.expected_revision < 0) {
      throw new WatchPartyError("invalid expected revision", 400, "social_watch_party_invalid_playback");
    }
    if (input.expected_revision !== room.playback.revision) {
      throw new WatchPartyError("playback state changed", 409, "social_watch_party_revision_conflict", { playback: clonePlayback(room.playback) });
    }

    const now = this.#now();
    const recentPlayback = (room.playbackRate.get(userId) ?? []).filter((at) => now - at < this.#playbackRateWindowMs);
    if (recentPlayback.length >= this.#playbackRateLimit) {
      throw new WatchPartyError("too many playback updates", 429, "social_watch_party_playback_rate_limited");
    }
    recentPlayback.push(now);
    room.playbackRate.set(userId, recentPlayback);
    room.playback = {
      revision: room.playback.revision + 1,
      position,
      paused,
      playback_rate: playbackRate,
      updated_at: Math.max(now, room.playback.updated_at + 1),
    };
    room.lastActivityAt = now;
    const playback = clonePlayback(room.playback);
    room.playbackReceipts.set(clientEventId, playback);
    while (room.playbackReceipts.size > 100) room.playbackReceipts.delete(room.playbackReceipts.keys().next().value!);
    this.#emit(room, { type: "playback", playback });
    return clonePlayback(playback);
  }

  addMessage(roomId: string, userId: number, value: unknown): SocialWatchPartyMessage {
    this.sweep();
    const room = this.#room(roomId);
    const member = this.#member(room, userId);
    const body = normalizedMessageBody(value);
    const now = this.#now();
    const recent = (room.messageRate.get(userId) ?? []).filter((at) => now - at < this.#messageRateWindowMs);
    if (recent.length >= this.#messageRateLimit) {
      throw new WatchPartyError("too many messages", 429, "social_watch_party_message_rate_limited");
    }
    recent.push(now);
    room.messageRate.set(userId, recent);
    const message: SocialWatchPartyMessage = {
      id: this.#id(),
      sequence: ++room.messageSequence,
      body,
      created_at: new Date(now).toISOString(),
      author: cloneProfile(member.profile),
    };
    room.messages.push(message);
    while (room.messages.length > this.#maxMessages) room.messages.shift();
    room.lastActivityAt = now;
    const result = cloneMessage(message);
    this.#emit(room, { type: "message", message: result });
    return cloneMessage(result);
  }

  close(roomId: string, userId: number, isAdmin: boolean, reason = "closed"): void {
    this.sweep();
    const room = this.#room(roomId);
    if (!isAdmin && room.hostUserId !== userId) throw new WatchPartyError("only the host can close the room", 403, "social_watch_party_host_only");
    this.#closeRoom(room, reason);
  }

  closeAll(reason = "closed"): void {
    for (const room of [...this.#rooms.values()]) this.#closeRoom(room, reason);
  }

  sweep(): void {
    const now = this.#now();
    for (const room of [...this.#rooms.values()]) {
      if (now - room.lastActivityAt >= this.#roomTtlMs) {
        this.#closeRoom(room, "expired");
        continue;
      }
      let presenceChanged = false;
      for (const [userId, member] of room.members) {
        if (userId === room.hostUserId || member.offlineAt == null || this.#memberOnline(member, now)) continue;
        if (now - member.offlineAt >= this.#offlineMemberTtlMs) {
          room.members.delete(userId);
          room.messageRate.delete(userId);
          room.playbackRate.delete(userId);
          presenceChanged = true;
        }
      }
      const host = room.members.get(room.hostUserId);
      if (!host) {
        this.#closeRoom(room, "host_unavailable");
        continue;
      }
      if (!this.#memberOnline(host, now) && host.offlineAt != null && now - host.offlineAt >= this.#hostGraceMs) {
        const nextHost = [...room.members.entries()]
          .filter(([userId, member]) => userId !== room.hostUserId && this.#memberOnline(member, now))
          .sort(([, left], [, right]) => left.joinedOrder - right.joinedOrder)[0];
        if (!nextHost) {
          this.#closeRoom(room, "host_disconnected");
          continue;
        }
        room.hostUserId = nextHost[0];
        room.lastActivityAt = now;
        presenceChanged = true;
      }
      if (presenceChanged && this.#rooms.has(room.id)) this.#emitPresence(room);
    }
  }

  #room(roomId: string): RoomState {
    const room = this.#rooms.get(roomId);
    if (!room) throw new WatchPartyError("watch room not found", 404, "social_watch_party_not_found");
    return room;
  }

  #assertRoomCapacity(userId: number): void {
    if (this.#rooms.size >= this.#maxRooms) {
      throw new WatchPartyError("too many active watch rooms", 429, "social_watch_party_room_limit");
    }
    let hostedRooms = 0;
    for (const room of this.#rooms.values()) if (room.createdByUserId === userId) hostedRooms++;
    if (hostedRooms >= this.#maxRoomsPerHost) {
      throw new WatchPartyError("too many active watch rooms for this host", 429, "social_watch_party_host_room_limit");
    }
  }

  #member(room: RoomState, userId: number): MemberState {
    const member = room.members.get(userId);
    if (!member || !this.#memberOnline(member, this.#now())) {
      throw new WatchPartyError("join the watch room first", 403, "social_watch_party_not_joined");
    }
    return member;
  }

  #memberOnline(member: MemberState, now: number): boolean {
    return member.connections.size > 0 || member.provisionalUntil > now;
  }

  #onlineParticipants(room: RoomState, now: number): SocialWatchPartyProfile[] {
    return [...room.members.values()]
      .filter((member) => this.#memberOnline(member, now))
      .sort((left, right) => left.joinedOrder - right.joinedOrder)
      .map((member) => cloneProfile(member.profile));
  }

  #serializeRoom(room: RoomState, now: number): SocialWatchPartyRoom {
    const host = room.members.get(room.hostUserId);
    if (!host) throw new WatchPartyError("watch room host is unavailable", 409, "social_watch_party_host_unavailable");
    return {
      id: room.id,
      video_id: room.videoId,
      host: cloneProfile(host.profile),
      participants: this.#onlineParticipants(room, now),
      messages: room.messages.map(cloneMessage),
      playback: clonePlayback(room.playback),
      created_at: new Date(room.createdAt).toISOString(),
    };
  }

  #emit(room: RoomState, event: SocialWatchPartyEvent, exceptConnectionId?: string): void {
    for (const [connectionId, subscriber] of room.subscribers) {
      if (connectionId === exceptConnectionId) continue;
      try { subscriber.listener(event); } catch {}
    }
  }

  #emitPresence(room: RoomState, exceptConnectionId?: string): void {
    const now = this.#now();
    const host = room.members.get(room.hostUserId);
    if (!host) return;
    this.#emit(room, {
      type: "presence",
      host: cloneProfile(host.profile),
      participants: this.#onlineParticipants(room, now),
    }, exceptConnectionId);
  }

  #disconnect(roomId: string, connectionId: string): void {
    const room = this.#rooms.get(roomId);
    if (!room) return;
    const subscriber = room.subscribers.get(connectionId);
    if (!subscriber) return;
    room.subscribers.delete(connectionId);
    const member = room.members.get(subscriber.userId);
    if (!member) return;
    member.connections.delete(connectionId);
    if (member.connections.size === 0) {
      const now = this.#now();
      member.offlineAt = now;
      member.provisionalUntil = 0;
      room.lastActivityAt = now;
      this.#emitPresence(room);
    }
  }

  #closeRoom(room: RoomState, reason: string): void {
    if (!this.#rooms.delete(room.id)) return;
    this.#emit(room, { type: "closed", reason });
    room.subscribers.clear();
    room.members.clear();
    room.messages.length = 0;
    room.messageRate.clear();
    room.playbackRate.clear();
    room.playbackReceipts.clear();
  }
}

export const socialWatchPartyStore = new SocialWatchPartyStore({ autoSweep: true });
