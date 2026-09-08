interface CacheEntry<T> {
  promise: Promise<T>;
  // In-flight work does not expire. Successful work gets a TTL measured from
  // completion so a request arriving just afterwards can reuse the result.
  expiresAt: number | null;
}

export class AsyncTtlCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(options: { ttlMs: number; maxEntries?: number; now?: () => number }) {
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs;
    this.maxEntries = options.maxEntries ?? 256;
  }

  run(key: string, load: () => Promise<T>, force = false): Promise<T> {
    this.pruneExpired(this.now());

    const existing = this.entries.get(key);
    // A forced refresh skips a completed result, but still shares work that is
    // already running: there is no older answer to refresh yet.
    if (existing && (!force || existing.expiresAt === null)) return existing.promise;
    if (existing) this.entries.delete(key);

    this.trimCompleted(this.maxEntries - 1);
    const entry: CacheEntry<T> = {
      expiresAt: null,
      promise: Promise.resolve().then(load).then(
        (result) => {
          if (this.entries.get(key) === entry) {
            entry.expiresAt = this.now() + this.ttlMs;
            this.pruneExpired(this.now());
            this.trimCompleted(this.maxEntries);
          }
          return result;
        },
        (error) => {
          // Failed work must remain retryable.
          if (this.entries.get(key) === entry) this.entries.delete(key);
          throw error;
        },
      ),
    };
    this.entries.set(key, entry);
    return entry.promise;
  }

  private pruneExpired(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt !== null && entry.expiresAt <= now) this.entries.delete(key);
    }
  }

  private trimCompleted(maxSize: number): void {
    while (this.entries.size > Math.max(0, maxSize)) {
      const completed = [...this.entries].find(([, entry]) => entry.expiresAt !== null);
      if (!completed) break;
      this.entries.delete(completed[0]);
    }
  }
}
