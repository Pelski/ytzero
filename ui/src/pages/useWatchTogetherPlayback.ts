import { useEffect, useMemo, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { SocialWatchPartyPlayback } from "../api";
import { useWatchTogetherRoom } from "../components/social/useWatchTogetherRoom";
import { sendPlayerCommand, type EnhancePlayerState } from "../enhanceBridge";
import { emitToast } from "../events";
import { watchPartyPlayerStatePaused } from "../watchTogetherRuntime";
import type { PlayerKind } from "./watchPlayerMode";
import type { WatchPlayerHandle } from "../playerHandle";

type MoreView = "root" | "speed" | "watchlater" | "playlist";

export function useWatchTogetherPlayback({
  configReady,
  enabled,
  enhancePlayerStateRef,
  id,
  joinErrorLabel,
  playerKind,
  playerRef,
  requestPlayback,
  roomId,
  setMoreView,
  setRoomId,
  setSpeed,
  setSpeedOpen,
  speedRef,
  videoId,
}: {
  configReady: boolean;
  enabled: boolean;
  enhancePlayerStateRef: MutableRefObject<{ state: EnhancePlayerState; updatedAt: number } | null>;
  id?: string;
  joinErrorLabel: string;
  playerKind: PlayerKind;
  playerRef: MutableRefObject<WatchPlayerHandle | null>;
  requestPlayback: () => void;
  roomId: string | null;
  setMoreView: Dispatch<SetStateAction<MoreView>>;
  setRoomId: (roomId: string | null) => void;
  setSpeed: Dispatch<SetStateAction<string>>;
  setSpeedOpen: Dispatch<SetStateAction<boolean>>;
  speedRef: MutableRefObject<string>;
  videoId?: string | null;
}) {
  const transportLockedRef = useRef(false);
  const player = useMemo(() => ({
    readPlayback: () => {
      const activePlayer = playerRef.current;
      const playerState = Number(activePlayer?.getPlayerState?.());
      const enhancedSnapshot = playerKind === "youtube" ? enhancePlayerStateRef.current : null;
      const enhanced = enhancedSnapshot && Date.now() - enhancedSnapshot.updatedAt < 2_500
        ? enhancedSnapshot.state
        : null;
      if (enhanced) return {
        position: Math.max(0, enhanced.currentTime),
        paused: watchPartyPlayerStatePaused(playerState, enhanced.paused || enhanced.ended),
        playback_rate: enhanced.playbackRate || Number(speedRef.current) || 1,
      };
      if (!activePlayer?.getCurrentTime || !activePlayer?.getPlayerState) return null;
      const position = Number(activePlayer.getCurrentTime());
      if (!Number.isFinite(position) || !Number.isFinite(playerState)) return null;
      const playerRate = Number(activePlayer.getPlaybackRate?.());
      return {
        position: Math.max(0, position),
        paused: watchPartyPlayerStatePaused(playerState, true),
        playback_rate: Number.isFinite(playerRate) && playerRate > 0 ? playerRate : Number(speedRef.current) || 1,
      };
    },
    applyPlayback: (playback: SocialWatchPartyPlayback, targetPosition: number) => {
      const activePlayer = playerRef.current;
      const enhancedSnapshot = playerKind === "youtube" ? enhancePlayerStateRef.current : null;
      const enhanceReady = Boolean(enhancedSnapshot && Date.now() - enhancedSnapshot.updatedAt < 2_500);
      if (!activePlayer && !enhanceReady) return false;

      const currentPosition = enhanceReady
        ? enhancedSnapshot!.state.currentTime
        : Number(activePlayer?.getCurrentTime?.());
      const currentRate = enhanceReady
        ? enhancedSnapshot!.state.playbackRate
        : Number(activePlayer?.getPlaybackRate?.() ?? speedRef.current);
      const playerState = Number(activePlayer?.getPlayerState?.());
      const currentPaused = enhanceReady
        ? watchPartyPlayerStatePaused(playerState, enhancedSnapshot!.state.paused || enhancedSnapshot!.state.ended)
        : watchPartyPlayerStatePaused(playerState, true);
      const fallbackSeek = () => activePlayer?.seekTo?.(targetPosition, true);
      const fallbackRate = () => activePlayer?.setPlaybackRate?.(playback.playback_rate);
      const fallbackState = () => playback.paused ? activePlayer?.pauseVideo?.() : activePlayer?.playVideo?.();

      if (!Number.isFinite(currentPosition) || Math.abs(currentPosition - targetPosition) > 0.75) {
        fallbackSeek();
        if (id && playerKind === "youtube") void sendPlayerCommand(id, "seek-to", { seconds: targetPosition }).catch(() => {});
      }
      if (!Number.isFinite(currentRate) || Math.abs(currentRate - playback.playback_rate) > 0.01) {
        const rate = String(playback.playback_rate);
        setSpeed(rate);
        speedRef.current = rate;
        fallbackRate();
        if (id && playerKind === "youtube") void sendPlayerCommand(id, "set-playback-rate", { rate: playback.playback_rate }).catch(() => {});
      }
      if (currentPaused !== playback.paused) {
        fallbackState();
        if (id && playerKind === "youtube") void sendPlayerCommand(id, playback.paused ? "pause" : "play").catch(() => {});
      }
      return true;
    },
    resumeSoloPlayback: () => {
      if (playerKind === "youtube") requestPlayback();
      else playerRef.current?.playVideo?.();
    },
  }), [enhancePlayerStateRef, id, playerKind, playerRef, requestPlayback, setSpeed, speedRef]);

  const room = useWatchTogetherRoom({ enabled, roomId, videoId, setRoomId, player });
  const transportLocked = Boolean(roomId) && (
    !room.room
    || room.selfId == null
    || room.room.host.id !== room.selfId
  );

  useEffect(() => {
    transportLockedRef.current = transportLocked;
    if (!transportLocked) return;
    setSpeedOpen(false);
    setMoreView((current) => current === "speed" ? "root" : current);
  }, [setMoreView, setSpeedOpen, transportLocked]);

  // A cross-origin iframe cannot expose individual controls to the parent.
  // Host-driven commands still use the player API; page theater remains active.
  useEffect(() => {
    if (playerKind !== "youtube") return;
    const iframe = playerRef.current?.getIframe?.();
    if (!iframe) return;
    if (transportLocked) {
      iframe.tabIndex = -1;
      if (document.activeElement === iframe) iframe.blur();
    } else {
      iframe.removeAttribute("tabindex");
    }
  }, [playerKind, playerRef, transportLocked]);

  useEffect(() => {
    if (!configReady || !roomId || enabled) return;
    emitToast(joinErrorLabel, "danger");
    room.leave();
  }, [configReady, enabled, joinErrorLabel, room.leave, roomId]);

  return { room, transportLocked, transportLockedRef };
}
