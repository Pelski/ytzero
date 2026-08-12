export interface ExpiringAudioSource {
  expiresAt: number;
}

export function audioSourceKey(userId: number, videoId: string): string {
  return `${userId}:${videoId}`;
}

/** A small per-profile LRU for bearer-like direct media URLs. */
export class AudioSourceCache<T extends ExpiringAudioSource> {
  readonly #entries = new Map<string, T>();

  constructor(
    private readonly maximumEntries = 512,
    private readonly now: () => number = Date.now,
  ) {}

  get size(): number {
    return this.#entries.size;
  }

  get(userId: number, videoId: string): T | null {
    this.sweepExpired();
    const key = audioSourceKey(userId, videoId);
    const value = this.#entries.get(key);
    if (!value) return null;
    // Refresh insertion order so the bounded map behaves as an LRU.
    this.#entries.delete(key);
    this.#entries.set(key, value);
    return value;
  }

  set(userId: number, videoId: string, value: T): void {
    this.sweepExpired();
    const key = audioSourceKey(userId, videoId);
    this.#entries.delete(key);
    while (this.#entries.size >= this.maximumEntries) {
      const oldest = this.#entries.keys().next().value as string | undefined;
      if (oldest == null) break;
      this.#entries.delete(oldest);
    }
    this.#entries.set(key, value);
  }

  delete(userId: number, videoId: string): void {
    this.#entries.delete(audioSourceKey(userId, videoId));
  }

  invalidateUser(userId: number): void {
    const prefix = `${userId}:`;
    for (const key of this.#entries.keys()) {
      if (key.startsWith(prefix)) this.#entries.delete(key);
    }
  }

  sweepExpired(): void {
    const current = this.now();
    for (const [key, value] of this.#entries) {
      if (value.expiresAt <= current) this.#entries.delete(key);
    }
  }
}
