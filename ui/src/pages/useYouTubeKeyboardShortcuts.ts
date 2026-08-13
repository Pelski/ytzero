import { useEffect, useRef, type MutableRefObject } from "react";
import type { LocalPlayerShortcut } from "../components/LocalPlayer";
import { sendPlayerCommand, type EnhancePlayerState } from "../enhanceBridge";
import type { PlayerKind } from "./watchPlayerMode";
import type { WatchPlayerHandle } from "../playerHandle";
import { stepPlaybackRate } from "../playbackSpeedStep";
import { resolveShortcutBindings, shortcutActionMatches } from "../keyboardShortcuts";
import type { VideoChapter } from "../api";

export type WatchShortcutKind = LocalPlayerShortcut | "sponsorblock" | "screenshotUnsupported";

export function useYouTubeKeyboardShortcuts({
  audioActive,
  enhancePlayerStateRef,
  id,
  keyboardSeekSeconds,
  keyboardShortcuts,
  frameRate,
  chapters,
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
  keyboardShortcuts?: string;
  frameRate: number;
  chapters: VideoChapter[];
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
    const bindings = resolveShortcutBindings(keyboardShortcuts);
    const matches = (action: Parameters<typeof shortcutActionMatches>[0], event: KeyboardEvent) => shortcutActionMatches(action, event, bindings);
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as Element).closest("input,textarea,select,[contenteditable]")) return;
      const player = playerRef.current;
      if (!player) return;
      if (transportLocked && (["temporaryBoost", "togglePlay", "seekBack10", "seekForward10", "previousFrame", "nextFrame", "speedDown", "speedUp", "seekPercent", "previousChapter", "nextChapter", "seekBack", "seekForward"] as const).some((action) => matches(action, event))) {
        event.preventDefault();
        return;
      }

      if (matches("temporaryBoost", event)) {
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

      const speedDirection = matches("speedDown", event) ? -1 : matches("speedUp", event) ? 1 : null;
      if (speedDirection !== null) {
        event.preventDefault();
        // The bridge applies commands asynchronously and YT.Player may report
        // the previous rate until its next state update. The ref is updated
        // synchronously below, so consecutive presses always build on the
        // result of the preceding shortcut instead of repeating one step.
        const currentRate = Number(speedRef.current);
        const nextRate = stepPlaybackRate(currentRate, speedDirection);
        speedRef.current = String(nextRate);
        const applyFallback = () => player.setPlaybackRate?.(nextRate);
        if (id && !audioActive) void sendPlayerCommand(id, "set-playback-rate", { rate: nextRate }).catch(applyFallback);
        else applyFallback();
        showFeedback("speed", nextRate);
        return;
      }

      if (matches("screenshot", event)) {
        event.preventDefault();
        if (!event.repeat) {
          if (audioActive) showFeedback("screenshotUnsupported");
          else takeScreenshot();
        }
        return;
      }

      if (matches("toggleMute", event)) {
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

      if (matches("togglePlay", event)) { event.preventDefault(); if (!event.repeat) { if (player.getPlayerState?.() === 1) player.pauseVideo?.(); else player.playVideo?.(); } return; }

      if (matches("toggleCaptions", event)) { event.preventDefault(); if (!event.repeat && id && !audioActive) void sendPlayerCommand(id, "toggle-captions").catch(() => { const track = player.getOption?.("captions", "track") as { languageCode?: string } | undefined; if (track?.languageCode) player.unloadModule?.("captions"); else player.loadModule?.("captions"); }); return; }

      if (matches("subtitleLarger", event) || matches("subtitleSmaller", event)) { event.preventDefault(); if (id && !audioActive) { const current = enhancePlayerStateRef.current?.state.captionSize ?? 19; void sendPlayerCommand(id, "set-caption-size", { size: Math.min(48, Math.max(12, current + (matches("subtitleLarger", event) ? 1 : -1))) }).catch(() => {}); } return; }

      if (matches("togglePictureInPicture", event)) { event.preventDefault(); if (!event.repeat && id && !audioActive) void sendPlayerCommand(id, "toggle-picture-in-picture").catch(() => {}); return; }

      if (matches("previousFrame", event) || matches("nextFrame", event)) { if (player.getPlayerState?.() === 2) { event.preventDefault(); const current = player.getCurrentTime?.(); if (Number.isFinite(current)) player.seekTo?.(Math.max(0, current! + (matches("previousFrame", event) ? -1 : 1) / frameRate), true); } return; }

      if (matches("previousChapter", event) || matches("nextChapter", event)) { const current = player.getCurrentTime?.(); if (!Number.isFinite(current) || !chapters.length) return; event.preventDefault(); const starts = chapters.map((chapter) => chapter.start); const target = matches("previousChapter", event) ? [...starts].reverse().find((start) => start < current! - 1) ?? 0 : starts.find((start) => start > current! + 1); if (target != null) player.seekTo?.(target, true); return; }

      const seekDirection = matches("seekBack10", event) ? -10 : matches("seekForward10", event) ? 10 : matches("seekBack", event) ? -keyboardSeekSeconds : matches("seekForward", event) ? keyboardSeekSeconds : 0;
      if (seekDirection) {
        const current = player.getCurrentTime?.();
        const duration = player.getDuration?.();
        if (!Number.isFinite(current) || !Number.isFinite(duration)) return;
        event.preventDefault();
        player.seekTo?.(Math.min(Math.max(0, current! + seekDirection), duration!), true);
        showFeedback(seekDirection < 0 ? "back" : "forward", Math.abs(seekDirection));
        return;
      }

      if (matches("volumeUp", event) || matches("volumeDown", event)) {
        const volume = player.getVolume?.();
        if (!Number.isFinite(volume)) return;
        event.preventDefault();
        const up = matches("volumeUp", event);
        const next = Math.min(100, Math.max(0, volume! + (up ? 5 : -5)));
        player.setVolume?.(next);
        if (next > 0) player.unMute?.();
        showFeedback(up ? "volumeUp" : "volumeDown");
        return;
      }

      if (matches("seekPercent", event) && /^Digit[0-9]$/.test(event.code)) { const duration = player.getDuration?.(); if (Number.isFinite(duration) && duration! > 0) { event.preventDefault(); player.seekTo?.(Number(event.code.slice(-1)) / 10 * duration!, true); } }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (!matches("temporaryBoost", event)) return;
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
  }, [audioActive, chapters, enhancePlayerStateRef, frameRate, id, keyboardSeekSeconds, keyboardShortcuts, playerKind, playerRef, showFeedback, speedRef, takeScreenshot, transportLocked]);
}
