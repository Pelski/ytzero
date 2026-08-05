import { api } from "./api";
import { isIncognitoMode } from "./incognitoMode";

interface ProgressWrite {
  position: number;
  duration: number;
}

interface ProgressWriteState {
  latest: ProgressWrite | null;
  lastSentAt: number;
  running: boolean;
  flushAfterRunning: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

export const PROGRESS_WRITE_INTERVAL_MS = 10_000;
const states = new Map<string, ProgressWriteState>();

function stateFor(videoId: string) {
  const existing = states.get(videoId);
  if (existing) return existing;
  const state: ProgressWriteState = { latest: null, lastSentAt: 0, running: false, flushAfterRunning: false, timer: null };
  states.set(videoId, state);
  return state;
}

function discard(videoId: string) {
  const state = states.get(videoId);
  if (state?.timer) clearTimeout(state.timer);
  states.delete(videoId);
}

function schedule(videoId: string, state: ProgressWriteState) {
  if (!state.latest || state.running || state.timer) return;
  const delay = Math.max(0, PROGRESS_WRITE_INTERVAL_MS - (Date.now() - state.lastSentAt));
  if (delay === 0) {
    void send(videoId, state);
    return;
  }
  state.timer = setTimeout(() => {
    state.timer = null;
    void send(videoId, state);
  }, delay);
}

async function send(videoId: string, state: ProgressWriteState, keepalive = false) {
  if (state.running || !state.latest) return;
  const next = state.latest;
  state.latest = null;
  state.running = true;
  state.lastSentAt = Date.now();
  try {
    if (!isIncognitoMode()) await api.saveProgress(videoId, next.position, next.duration, keepalive);
  } catch {
    // A later playback sample retries with fresh state. Retaining this value
    // could overwrite an intentional seek after connectivity returns.
  } finally {
    state.running = false;
    if (state.flushAfterRunning) {
      state.flushAfterRunning = false;
      state.lastSentAt = 0;
    }
    schedule(videoId, state);
  }
}

/**
 * Player state is sampled every second, but persistence is a throttled
 * heartbeat. Keep only the newest sample and at most one request in flight.
 */
export function queueProgressWrite(videoId: string, position: number, duration: number) {
  if (isIncognitoMode()) {
    discard(videoId);
    return;
  }
  const state = stateFor(videoId);
  state.latest = { position, duration };
  schedule(videoId, state);
}

/** Persist the newest sample now, for pauses, navigation and page lifecycle. */
export function flushProgressWrite(videoId: string, keepalive = false) {
  const state = states.get(videoId);
  if (!state?.latest || isIncognitoMode()) {
    if (isIncognitoMode()) discard(videoId);
    return;
  }
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  if (state.running) {
    if (keepalive) {
      const next = state.latest;
      state.latest = null;
      state.lastSentAt = Date.now();
      void api.saveProgress(videoId, next.position, next.duration, true).catch(() => {});
    } else {
      state.flushAfterRunning = true;
    }
    return;
  }
  state.lastSentAt = 0;
  void send(videoId, state, keepalive);
}
