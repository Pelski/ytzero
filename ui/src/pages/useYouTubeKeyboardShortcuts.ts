import { useEffect, useRef, type MutableRefObject } from "react";
import type { LocalPlayerShortcut } from "../components/LocalPlayer";
import { sendPlayerCommand, type EnhancePlayerState } from "../enhanceBridge";
import type { PlayerKind } from "./watchPlayerMode";
import type { WatchPlayerHandle } from "../playerHandle";

export type WatchShortcutKind = LocalPlayerShortcut | "sponsorblock" | "screenshotUnsupported";

export function useYouTubeKeyboardShortcuts({
  audioActive,
  enhancePlayerStateRef,
  id,
  keyboardSeekSeconds,
  playerKind,
  playerRef,
  showFeedback,
  speedRef,
  takeScreenshot,
  transportLocked,
}: {
  audioActive: boolean;
  enhancePlayerStateRef: MutableRefObject<{ state: EnhancePlayerState; updatedAt: number } | null>;
  id?: string;
  keyboardSeekSeconds: number;
  playerKind: PlayerKind;
  playerRef: MutableRefObject<WatchPlayerHandle | null>;
  showFeedback: (kind: WatchShortcutKind, seconds?: number, category?: string) => void;
  speedRef: MutableRefObject<string>;
  takeScreenshot: () => void;
  transportLocked: boolean;
}) {
  const spaceHoldTimerRef = useRef<number | null>(null);
  const spaceHoldActiveRef = useRef(false);

  // The YouTube iframe only receives built-in shortcuts after focus. Mirror
  // essential keys at page level; LocalPlayer owns the equivalent behavior.
  useEffect(() => {
    if (playerKind !== "youtube" && !audioActive) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if ((event.target as Element).closest("input,textarea,select,[contenteditable]")) return;
      const player = playerRef.current;
      if (!player) return;
      if (transportLocked && (
        event.code === "Space"
        || event.key === "ArrowLeft"
        || event.key === "ArrowRight"
        || /^[jkl0-9]$/i.test(event.key)
      )) {
        event.preventDefault();
        return;
      }

      if (event.code === "Space") {
        event.preventDefault();
        if (event.repeat || spaceHoldTimerRef.current != null || spaceHoldActiveRef.current) return;
        spaceHoldTimerRef.current = window.setTimeout(() => {
          spaceHoldTimerRef.current = null;
          const activePlayer = playerRef.current;
          if (!activePlayer) return;
          spaceHoldActiveRef.current = true;
          activePlayer.setPlaybackRate?.(2);
          showFeedback("speed");
        }, 220);
        return;
      }

      if (event.key === "s" || event.key === "S") {
        event.preventDefault();
        if (!event.repeat) {
          if (audioActive) showFeedback("screenshotUnsupported");
          else takeScreenshot();
        }
        return;
      }

      if (event.key === "m" || event.key === "M") {
        event.preventDefault();
        if (event.repeat) return;
        const enhancedState = audioActive ? null : enhancePlayerStateRef.current?.state;
        const muted = enhancedState?.muted ?? Boolean(player.isMuted?.());
        showFeedback(muted ? "unmute" : "mute");
        if (id && !audioActive) {
          void sendPlayerCommand(id, "toggle-muted").catch(() => {
            if (muted) player.unMute?.();
            else player.mute?.();
          });
        } else if (muted) player.unMute?.();
        else player.mute?.();
        return;
      }

      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        const current = player.getCurrentTime?.();
        const duration = player.getDuration?.();
        if (!Number.isFinite(current) || !Number.isFinite(duration)) return;
        event.preventDefault();
        const delta = event.key === "ArrowLeft" ? -keyboardSeekSeconds : keyboardSeekSeconds;
        player.seekTo?.(Math.min(Math.max(0, current! + delta), duration!), true);
        showFeedback(event.key === "ArrowLeft" ? "back" : "forward", keyboardSeekSeconds);
        return;
      }

      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        const volume = player.getVolume?.();
        if (!Number.isFinite(volume)) return;
        event.preventDefault();
        const next = Math.min(100, Math.max(0, volume! + (event.key === "ArrowUp" ? 5 : -5)));
        player.setVolume?.(next);
        if (next > 0) player.unMute?.();
        showFeedback(event.key === "ArrowUp" ? "volumeUp" : "volumeDown");
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      if ((event.target as Element).closest("input,textarea,select,[contenteditable]")) return;
      event.preventDefault();
      if (transportLocked) {
        if (spaceHoldTimerRef.current != null) window.clearTimeout(spaceHoldTimerRef.current);
        spaceHoldTimerRef.current = null;
        if (spaceHoldActiveRef.current) playerRef.current?.setPlaybackRate?.(Number(speedRef.current));
        spaceHoldActiveRef.current = false;
        return;
      }
      if (spaceHoldTimerRef.current != null) {
        window.clearTimeout(spaceHoldTimerRef.current);
        spaceHoldTimerRef.current = null;
        const player = playerRef.current;
        if (player?.getPlayerState?.() === 1) player.pauseVideo?.();
        else player?.playVideo?.();
      } else if (spaceHoldActiveRef.current) {
        spaceHoldActiveRef.current = false;
        playerRef.current?.setPlaybackRate?.(Number(speedRef.current));
      }
    };

    document.addEventListener("keydown", onKey);
    document.addEventListener("keyup", onKeyUp);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("keyup", onKeyUp);
      if (spaceHoldTimerRef.current != null) window.clearTimeout(spaceHoldTimerRef.current);
      if (spaceHoldActiveRef.current) playerRef.current?.setPlaybackRate?.(Number(speedRef.current));
      spaceHoldTimerRef.current = null;
      spaceHoldActiveRef.current = false;
    };
  }, [audioActive, enhancePlayerStateRef, id, keyboardSeekSeconds, playerKind, playerRef, showFeedback, speedRef, takeScreenshot, transportLocked]);
}
