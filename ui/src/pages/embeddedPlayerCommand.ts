import { sendPlayerCommand, type EnhancePlayerCommand } from "../enhanceBridge";
import type { PlayerKind } from "./watchPlayerMode";

type PlayerCommandSender = (
  videoId: string,
  command: EnhancePlayerCommand,
  payload?: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

/**
 * Routes commands through YT Zero Enhance only for an actual YouTube iframe.
 * Audio and non-iframe players always retain their native player behavior.
 */
export async function applyEmbeddedPlayerCommand({
  audioActive,
  command,
  fallback,
  payload,
  playerKind,
  sendCommand = sendPlayerCommand,
  shouldFallback = () => true,
  videoId,
}: {
  audioActive: boolean;
  command: EnhancePlayerCommand;
  fallback: () => void;
  payload?: Record<string, unknown>;
  playerKind: PlayerKind;
  sendCommand?: PlayerCommandSender;
  shouldFallback?: () => boolean;
  videoId?: string;
}): Promise<"bridge" | "fallback" | "superseded"> {
  if (playerKind === "youtube" && videoId && !audioActive) {
    try {
      await sendCommand(videoId, command, payload);
      return "bridge";
    } catch {}
  }

  if (!shouldFallback()) return "superseded";
  fallback();
  return "fallback";
}
