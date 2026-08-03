import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  ApiError,
  type SocialWatchParty,
  type SocialWatchPartyEvent,
  type SocialWatchPartyPlayback,
} from "../../api";
import { probeApiAuthentication } from "../../apiTransport";
import {
  mergeWatchPartyMessages,
  projectWatchPartyPosition,
  shouldPublishWatchPartyPlayback,
  watchPartyPlaybackNeedsCorrection,
  type WatchPartyPlaybackDraft,
} from "../../watchTogetherRuntime";

export type WatchTogetherRoomError = "join" | "connection" | "closed" | null;

export interface WatchTogetherPlayerAdapter {
  readPlayback: () => WatchPartyPlaybackDraft | null;
  /** Returns false while the underlying player is not ready yet. */
  applyPlayback: (playback: SocialWatchPartyPlayback, targetPosition: number) => boolean;
  resumeSoloPlayback?: () => void;
}

export function useWatchTogetherRoom({
  enabled,
  roomId,
  videoId,
  setRoomId,
  player,
}: {
  enabled: boolean;
  roomId: string | null;
  videoId: string | null | undefined;
  setRoomId: (roomId: string | null) => void;
  player: WatchTogetherPlayerAdapter;
}) {
  const [room, setRoom] = useState<SocialWatchParty | null>(null);
  const [selfId, setSelfId] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);
  const [bootstrapped, setBootstrapped] = useState(!roomId);
  const [starting, setStarting] = useState(false);
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<WatchTogetherRoomError>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const copyTimerRef = useRef<number | null>(null);
  const lastAppliedRevisionRef = useRef(-1);
  const lastSentRef = useRef<{ playback: WatchPartyPlaybackDraft; at: number } | null>(null);
  const playbackRevisionRef = useRef(0);
  const playbackReceiptRef = useRef<{ roomId: string; revision: number; receivedAt: number } | null>(null);
  const publishInFlightRef = useRef(false);
  const hostPlaybackReadyRef = useRef(false);

  useEffect(() => { playbackRevisionRef.current = room?.playback.revision ?? 0; }, [room?.playback.revision]);

  const rememberPlaybackReceipt = useCallback((nextRoomId: string, playback: SocialWatchPartyPlayback) => {
    const current = playbackReceiptRef.current;
    if (current?.roomId === nextRoomId && current.revision >= playback.revision) return;
    playbackReceiptRef.current = { roomId: nextRoomId, revision: playback.revision, receivedAt: performance.now() };
  }, []);

  const mergeRoom = useCallback((next: SocialWatchParty) => {
    setRoom((current) => {
      if (current && current.id !== next.id) return current;
      return current
        ? {
          ...next,
          playback: current.playback.revision > next.playback.revision ? current.playback : next.playback,
          messages: mergeWatchPartyMessages(current.messages, next.messages),
        }
        : next;
    });
  }, []);

  const applyEvent = useCallback((event: SocialWatchPartyEvent, eventRoomId: string) => {
    if (event.type === "snapshot") {
      if (event.room.id !== eventRoomId) return;
      hostPlaybackReadyRef.current = false;
      rememberPlaybackReceipt(eventRoomId, event.room.playback);
      setSelfId(event.self_id);
      mergeRoom(event.room);
      setConnected(true);
      setBootstrapped(true);
      setError(null);
      return;
    }
    if (event.type === "playback") {
      rememberPlaybackReceipt(eventRoomId, event.playback);
      setRoom((current) => current?.id === eventRoomId && event.playback.revision > current.playback.revision
        ? { ...current, playback: event.playback }
        : current);
      return;
    }
    if (event.type === "message") {
      setRoom((current) => current?.id === eventRoomId ? { ...current, messages: mergeWatchPartyMessages(current.messages, [event.message]) } : current);
      return;
    }
    if (event.type === "presence") {
      setRoom((current) => current?.id === eventRoomId ? { ...current, host: event.host, participants: event.participants } : current);
      return;
    }
    sourceRef.current?.close();
    sourceRef.current = null;
    setConnected(false);
    hostPlaybackReadyRef.current = false;
    setRoom((current) => current?.id === eventRoomId ? null : current);
    setSelfId(null);
    setBootstrapped(true);
    setError("closed");
  }, [mergeRoom, rememberPlaybackReceipt]);

  useEffect(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
    setConnected(false);
    setRoom(null);
    setSelfId(null);
    setCopied(false);
    lastAppliedRevisionRef.current = -1;
    lastSentRef.current = null;
    playbackReceiptRef.current = null;
    publishInFlightRef.current = false;
    hostPlaybackReadyRef.current = false;

    if (!roomId) {
      setBootstrapped(true);
      setError(null);
      return;
    }
    setBootstrapped(false);
    setError(null);
    if (!enabled || !videoId) return;

    let cancelled = false;
    void api.socialWatchParty(roomId).then((result) => {
      if (cancelled) return;
      if (result.room.video_id !== videoId) throw new Error("watch party video mismatch");
      rememberPlaybackReceipt(roomId, result.room.playback);
      setSelfId(result.self_id);
      mergeRoom(result.room);
      setBootstrapped(true);
      setError(null);

      const source = api.socialWatchPartyEvents(roomId);
      sourceRef.current = source;
      source.addEventListener("party", (raw) => {
        if (sourceRef.current !== source) return;
        try {
          applyEvent(JSON.parse((raw as MessageEvent<string>).data) as SocialWatchPartyEvent, roomId);
        } catch {}
      });
      source.addEventListener("error", () => {
        if (sourceRef.current !== source) return;
        setConnected(false);
        setError((current) => current === "closed" ? current : "connection");
        void probeApiAuthentication();
      });
    }).catch(() => {
      if (cancelled) return;
      setBootstrapped(true);
      setError("join");
    });

    return () => {
      cancelled = true;
      sourceRef.current?.close();
      sourceRef.current = null;
    };
  }, [applyEvent, enabled, mergeRoom, rememberPlaybackReceipt, roomId, videoId]);

  // Followers continuously enforce the host state. A host loading/reconnecting
  // first restores the server snapshot too; publishing stays gated until a
  // later read confirms that the dispatched commands actually took effect.
  useEffect(() => {
    if (!room || selfId == null) return;
    const isHost = room.host.id === selfId;
    const sync = () => {
      if (isHost && hostPlaybackReadyRef.current) return;
      const current = player.readPlayback();
      const receipt = playbackReceiptRef.current;
      if (!current || !receipt || receipt.roomId !== room.id || receipt.revision !== room.playback.revision) return;
      if (room.playback.revision < lastAppliedRevisionRef.current) return;
      const shouldCorrect = watchPartyPlaybackNeedsCorrection({
        current,
        incoming: room.playback,
        lastAppliedRevision: lastAppliedRevisionRef.current,
        receivedAt: receipt.receivedAt,
        now: performance.now(),
        enforceCurrentRevision: room.playback.revision === lastAppliedRevisionRef.current,
      });
      if (shouldCorrect) {
        if (!player.applyPlayback(
          room.playback,
          projectWatchPartyPosition(room.playback, receipt.receivedAt, performance.now()),
        )) return;
        if (room.playback.revision > lastAppliedRevisionRef.current) lastAppliedRevisionRef.current = room.playback.revision;
        if (isHost) return;
      }
      if (room.playback.revision > lastAppliedRevisionRef.current) lastAppliedRevisionRef.current = room.playback.revision;
      if (isHost) hostPlaybackReadyRef.current = true;
    };
    sync();
    const retry = window.setInterval(sync, 750);
    return () => window.clearInterval(retry);
  }, [player, room, selfId]);

  // The host samples the existing player API. State changes and seeks go out
  // quickly, while steady playback uses a sparse checkpoint to bound drift.
  useEffect(() => {
    if (!connected || !room || selfId == null || room.host.id !== selfId) return;
    const publish = () => {
      if (!hostPlaybackReadyRef.current) return;
      if (publishInFlightRef.current) return;
      const current = player.readPlayback();
      if (!current) return;
      const now = Date.now();
      const previous = lastSentRef.current;
      if (!shouldPublishWatchPartyPlayback({
        current,
        previous: previous?.playback ?? null,
        previousSentAt: previous?.at ?? 0,
        now,
      })) return;
      publishInFlightRef.current = true;
      void api.updateSocialWatchPartyPlayback(room.id, {
        ...current,
        expected_revision: playbackRevisionRef.current,
        client_event_id: crypto.randomUUID(),
      }).then(({ playback }) => {
        lastSentRef.current = { playback: current, at: now };
        playbackRevisionRef.current = playback.revision;
        rememberPlaybackReceipt(room.id, playback);
        setRoom((value) => value?.id === room.id ? { ...value, playback } : value);
        setError(null);
      }).catch((requestError) => {
        if (requestError instanceof ApiError && requestError.status === 409) {
          void api.socialWatchParty(room.id).then(({ room: latest }) => {
            hostPlaybackReadyRef.current = false;
            rememberPlaybackReceipt(latest.id, latest.playback);
            mergeRoom(latest);
          }).catch(() => {});
        } else {
          setError("connection");
        }
      }).finally(() => { publishInFlightRef.current = false; });
    };
    publish();
    const sampler = window.setInterval(publish, 500);
    return () => window.clearInterval(sampler);
  }, [connected, mergeRoom, player, rememberPlaybackReceipt, room?.host.id, room?.id, selfId]);

  const start = useCallback(async () => {
    if (!enabled || !videoId || starting) return;
    setStarting(true);
    setError(null);
    try {
      const initial = player.readPlayback() ?? { position: 0, paused: true, playback_rate: 1 };
      const result = await api.createSocialWatchParty(videoId, initial);
      rememberPlaybackReceipt(result.room.id, result.room.playback);
      setSelfId(result.self_id);
      mergeRoom(result.room);
      setBootstrapped(true);
      setRoomId(result.room.id);
    } catch {
      setError("join");
    } finally {
      setStarting(false);
    }
  }, [enabled, mergeRoom, player, rememberPlaybackReceipt, setRoomId, starting, videoId]);

  const sendMessage = useCallback(async (body: string) => {
    if (!room || !connected || sending) return;
    const sendingRoomId = room.id;
    setSending(true);
    try {
      const { message } = await api.sendSocialWatchPartyMessage(sendingRoomId, body);
      setRoom((current) => current?.id === sendingRoomId ? { ...current, messages: mergeWatchPartyMessages(current.messages, [message]) } : current);
      setError(null);
    } catch {
      setError("connection");
    } finally {
      setSending(false);
    }
  }, [connected, room, sending]);

  const copyInvite = useCallback(async () => {
    if (!room) return;
    const url = new URL(window.location.href);
    url.searchParams.set("room", room.id);
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopied(true);
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 1_800);
    } catch {
      setError("connection");
    }
  }, [room]);

  const leave = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
    setRoomId(null);
    player.resumeSoloPlayback?.();
  }, [player, setRoomId]);

  const end = useCallback(async () => {
    if (!room) return;
    try {
      await api.closeSocialWatchParty(room.id);
      leave();
    } catch {
      setError("connection");
    }
  }, [leave, room]);

  useEffect(() => () => {
    sourceRef.current?.close();
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
  }, []);

  return {
    room,
    selfId,
    connected,
    bootstrapped,
    starting,
    sending,
    copied,
    error,
    start,
    sendMessage,
    copyInvite,
    leave,
    end,
  };
}

export type WatchTogetherRoomController = ReturnType<typeof useWatchTogetherRoom>;
