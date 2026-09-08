import { log } from "./logger";

const REFUSAL_DELAYS_MS = [90_000, 3 * 60_000, 6 * 60_000, 12 * 60_000, 24 * 60_000, 30 * 60_000];

export class YouTubeRefusalError extends Error {
  constructor(public readonly retryAt: number) {
    super("YouTube requests are temporarily paused after an address refusal");
    this.name = "YouTubeRefusalError";
  }
}

export function isYouTubeRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return error instanceof YouTubeRefusalError || /(?:\b429\b|rate.?limit|too many requests|confirm you(?:'|’)re not a bot)/i.test(message);
}

/** Address-wide refusal, including the first ordinary error before callers
 * begin receiving the sentinel above. Keep this beside rate-limit detection so
 * new YouTube wording cannot make the two branches drift apart. */
export function isYouTubeRefusalError(error: unknown): boolean {
  if (error instanceof YouTubeRefusalError || isYouTubeRateLimitError(error)) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /LOGIN_REQUIRED/i.test(message)
    && /(?:sign in|log in|confirm you(?:'|’)re not a bot|bot)/i.test(message);
}

type RefusalLogger = Pick<typeof log, "info" | "warn">;

/** Process-local state: an egress address is shared by every profile, while
 * this is intentionally neither portable nor durable across a restart. */
export class YouTubeRefusalGate {
  private consecutive = 0;
  private retryAt = 0;
  private probing = false;
  private activeSince = 0;

  constructor(private readonly now: () => number = Date.now, private readonly logger: RefusalLogger = log) {}

  enter(): void {
    const now = this.now();
    // Healthy lookups may run concurrently. Serialize only the one recovery
    // probe after an address-wide refusal has actually begun.
    if (this.consecutive === 0) return;
    if (this.retryAt > now || this.probing) throw new YouTubeRefusalError(this.retryAt);
    this.probing = true;
  }

  refused(error: unknown): YouTubeRefusalError {
    const now = this.now();
    const wasActive = this.consecutive > 0;
    this.consecutive++;
    this.retryAt = now + REFUSAL_DELAYS_MS[Math.min(this.consecutive - 1, REFUSAL_DELAYS_MS.length - 1)];
    this.probing = false;
    if (!wasActive) {
      this.activeSince = now;
      this.logger.warn("youtube.refusal_started", { retryInSeconds: Math.round((this.retryAt - now) / 1_000) });
    }
    return new YouTubeRefusalError(this.retryAt);
  }

  answered(): void {
    if (this.consecutive > 0) {
      this.logger.info("youtube.refusal_lifted", {
        consecutiveRefusals: this.consecutive,
        durationMs: Math.max(0, this.now() - this.activeSince),
      });
    }
    this.consecutive = 0;
    this.retryAt = 0;
    this.probing = false;
    this.activeSince = 0;
  }

  releaseProbe(): void { this.probing = false; }
  nextRetryAt(): number { return this.retryAt; }
}

export const youtubeRefusalGate = new YouTubeRefusalGate();

export function isYouTubeBotChallenge(body: string): boolean {
  return /(?:confirm you(?:'|’)re not a bot|unusual traffic|automated quer(?:y|ies))/i.test(body);
}

export async function readYouTubeResponse(response: Response, failure: string, observe?: (body: string) => void): Promise<string> {
  const body = await response.text();
  observe?.(body);
  if (isYouTubeBotChallenge(body)) throw new Error("YouTube bot challenge: confirm you're not a bot");
  if (!response.ok) throw new Error(`${failure} (${response.status})`);
  return body;
}
