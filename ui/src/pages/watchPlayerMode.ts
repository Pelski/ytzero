export type WatchSourceMode = "youtube" | "ask" | "download";
export type SourceChoice = "undecided" | "youtube" | "wait";
export type PlayerKind = "loading" | "local" | "youtube" | "blocked" | "choice" | "waiting";

export function resolvePlayerKind(input: {
  hasVideo: boolean;
  downloadStatus: string | null;
  playerSource: "auto" | "youtube";
  playbackPolicyReady: boolean;
  childDownloadsOnly: boolean;
  sourceChoice: SourceChoice;
  watchMode: WatchSourceMode;
}): PlayerKind {
  if (input.hasVideo && input.downloadStatus === "done" && input.playerSource === "auto") return "local";
  if (!input.playbackPolicyReady) return "loading";
  if (input.hasVideo && input.childDownloadsOnly) return "blocked";
  if (input.hasVideo && input.sourceChoice === "wait") return "waiting";
  if (input.hasVideo && input.watchMode === "download" && input.sourceChoice !== "youtube") return "waiting";
  if (input.hasVideo && input.watchMode === "ask" && input.sourceChoice === "undecided") return "choice";
  return "youtube";
}
