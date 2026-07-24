export type WatchSourceMode = "youtube" | "ask" | "download";
export type SourceChoice = "undecided" | "youtube" | "wait";
export type PlayerKind = "loading" | "local" | "youtube" | "blocked" | "choice" | "waiting" | "stream";

export function resolvePlayerKind(input: {
  hasVideo: boolean;
  isLive: boolean;
  downloadStatus: string | null;
  playerSource: "auto" | "youtube";
  playbackPolicyReady: boolean;
  childDownloadsOnly: boolean;
  sourceChoice: SourceChoice;
  watchMode: WatchSourceMode;
  streamingEnabled: boolean;
}): PlayerKind {
  const canStream = input.hasVideo && input.streamingEnabled && input.playerSource === "auto" && input.sourceChoice !== "youtube";
  // A stream is not a stable local file. Even if an old download row exists,
  // always use YouTube while the broadcast is live or scheduled.
  if (input.hasVideo && input.isLive) return "youtube";
  // The fast background download finished: switch to the local file, which
  // seeks natively and perfectly (the streaming path hands off to it here).
  if (input.hasVideo && input.downloadStatus === "done" && input.playerSource === "auto") return "local";
  if (!input.playbackPolicyReady) return "loading";
  if (input.hasVideo && input.childDownloadsOnly) return "blocked";
  // Experimental: play-while-downloading. Holds the stream while the file is
  // still downloading; the viewer can still fall back to YouTube (which flips
  // sourceChoice / playerSource and skips this branch).
  if (canStream) return "stream";
  if (input.hasVideo && input.sourceChoice === "wait") return "waiting";
  if (input.hasVideo && input.watchMode === "download" && input.sourceChoice !== "youtube") return "waiting";
  if (input.hasVideo && input.watchMode === "ask" && input.sourceChoice === "undecided") return "choice";
  return "youtube";
}
