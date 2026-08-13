const TRANSCRIPT_CACHE_TTL_MS = 30 * 60_000;
const MAX_TRANSCRIPT_CACHE_ENTRIES = 256;

interface TranscriptCacheEntry {
  expiresAt: number;
  transcript: string;
}

export class TranscriptCache {
  private readonly entries = new Map<string, TranscriptCacheEntry>();
  private readonly pending = new Map<string, Promise<string>>();

  constructor(private readonly now: () => number = Date.now) {}

  async get(
    userId: number,
    videoId: string,
    language: string,
    load: () => Promise<string>,
  ): Promise<string> {
    const key = `${userId}:${videoId}:${language}`;
    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.transcript;
    if (cached) this.entries.delete(key);

    const existing = this.pending.get(key);
    if (existing) return existing;
    const request = load().then((transcript) => {
      if (transcript) {
        this.entries.set(key, { transcript, expiresAt: this.now() + TRANSCRIPT_CACHE_TTL_MS });
        while (this.entries.size > MAX_TRANSCRIPT_CACHE_ENTRIES) {
          const oldest = this.entries.keys().next().value as string | undefined;
          if (!oldest) break;
          this.entries.delete(oldest);
        }
      }
      return transcript;
    }).finally(() => {
      if (this.pending.get(key) === request) this.pending.delete(key);
    });
    this.pending.set(key, request);
    return request;
  }
}
