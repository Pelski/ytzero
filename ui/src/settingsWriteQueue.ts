import { api, type AppSettings } from "./api";

interface PendingSettingWrite {
  patch: Partial<AppSettings>;
  timer: number;
  onSaved?: () => void;
  onError?: (error: unknown) => void;
}

const pending = new Map<string, PendingSettingWrite>();
const queues = new Map<string, Promise<void>>();

function enqueueSettingWrite(
  key: string,
  patch: Partial<AppSettings>,
  options: Pick<PendingSettingWrite, "onSaved" | "onError"> = {},
) {
  const before = queues.get(key) ?? Promise.resolve();
  const write = before.catch(() => {}).then(async () => { await api.updateSettings(patch); });
  queues.set(key, write);
  void write
    .then(() => options.onSaved?.())
    .catch((error) => options.onError?.(error))
    .finally(() => {
      if (queues.get(key) === write) queues.delete(key);
    });
}

/** Serializes a discrete setting change immediately, preserving click order. */
export function queueSettingWrite(
  key: string,
  patch: Partial<AppSettings>,
  options: Pick<PendingSettingWrite, "onSaved" | "onError"> = {},
) {
  const delayed = pending.get(key);
  if (delayed) {
    window.clearTimeout(delayed.timer);
    pending.delete(key);
  }
  enqueueSettingWrite(key, patch, options);
}

/**
 * Coalesces high-frequency controls and serializes writes for the same setting.
 * The UI can update optimistically while only the last value in a burst reaches
 * the API; an already-running write always finishes before the next one starts.
 */
export function scheduleSettingWrite(
  key: string,
  patch: Partial<AppSettings>,
  options: { delay?: number; onSaved?: () => void; onError?: (error: unknown) => void } = {},
) {
  const previous = pending.get(key);
  if (previous) window.clearTimeout(previous.timer);

  const entry: PendingSettingWrite = {
    patch,
    onSaved: options.onSaved,
    onError: options.onError,
    timer: window.setTimeout(() => {
      if (pending.get(key) !== entry) return;
      pending.delete(key);
      enqueueSettingWrite(key, entry.patch, entry);
    }, options.delay ?? 300),
  };
  pending.set(key, entry);
}
