export type YtdlpUpdateChannel = "stable" | "nightly";

export const DEFAULT_YTDLP_UPDATE_CHANNEL: YtdlpUpdateChannel = "nightly";

export function resolveYtdlpUpdateChannel(configured: string | null): YtdlpUpdateChannel {
  if (configured === "stable" || configured === "nightly") return configured;
  return DEFAULT_YTDLP_UPDATE_CHANNEL;
}
