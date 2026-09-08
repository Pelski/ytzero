import type { WatchPlayerHandle } from "../playerHandle";
import type { PlayerKind } from "./watchPlayerMode";
import { applyEmbeddedPlayerCommand } from "./embeddedPlayerCommand";

export async function applyEmbeddedPlaybackRate({
  audioActive,
  getPlayer,
  playerKind,
  rate,
  sendCommand,
  shouldFallback = () => true,
  videoId,
}: {
  audioActive: boolean;
  getPlayer: () => WatchPlayerHandle | null;
  playerKind: PlayerKind;
  rate: number;
  sendCommand?: Parameters<typeof applyEmbeddedPlayerCommand>[0]["sendCommand"];
  shouldFallback?: () => boolean;
  videoId?: string;
}): Promise<"bridge" | "fallback" | "superseded"> {
  return applyEmbeddedPlayerCommand({
    audioActive,
    command: "set-playback-rate",
    fallback: () => getPlayer()?.setPlaybackRate?.(rate),
    payload: { rate },
    playerKind,
    sendCommand,
    shouldFallback,
    videoId,
  });
}
