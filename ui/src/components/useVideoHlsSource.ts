import { useEffect, useRef, type RefObject } from "react";
import {
  shouldUseNativeVideoHls,
  videoHlsRecoveryAction,
  videoHlsRecoveryPosition,
  videoHlsStartPosition,
} from "../videoHlsPolicy";

interface RecoverySnapshot {
  playing: boolean;
  position: number;
}

export function useVideoHlsSource({
  active,
  durationSeconds,
  mediaRef,
  onFatalError,
  onReady,
  src,
  startSeconds,
}: {
  active: boolean;
  durationSeconds?: number;
  mediaRef: RefObject<HTMLVideoElement | null>;
  onFatalError?: () => void;
  onReady: () => void;
  src: string;
  startSeconds: number;
}): void {
  const callbacksRef = useRef({ onFatalError, onReady });
  callbacksRef.current = { onFatalError, onReady };

  useEffect(() => {
    if (!active) return;
    const media = mediaRef.current;
    if (!media) return;
    const startPosition = videoHlsStartPosition(startSeconds, durationSeconds);
    let cancelled = false;
    let fatalReported = false;
    let hls: import("hls.js").default | null = null;
    let detachHlsMediaListeners = () => {};
    let mediaReady = false;
    let recoveryActive = false;
    let intendedPlaying = !media.paused && !media.ended;

    const onPlay = () => { intendedPlaying = true; };
    const onPause = () => {
      if (!cancelled && !recoveryActive && !media.error) intendedPlaying = false;
    };
    media.addEventListener("play", onPlay);
    media.addEventListener("pause", onPause);

    const fatal = () => {
      if (cancelled || fatalReported) return;
      fatalReported = true;
      callbacksRef.current.onFatalError?.();
    };
    const ready = () => {
      if (!cancelled) callbacksRef.current.onReady();
    };
    const recoverySnapshot = (): RecoverySnapshot => ({
      playing: intendedPlaying || (!media.paused && !media.ended),
      position: videoHlsRecoveryPosition(Number(media.currentTime), startPosition, mediaReady),
    });
    const applyPosition = (position: number) => {
      if (!Number.isFinite(position) || position < 0) return;
      try { media.currentTime = position; } catch {}
    };
    const restoreRecovery = (snapshot: RecoverySnapshot) => {
      applyPosition(snapshot.position);
      recoveryActive = false;
      if (snapshot.playing) void media.play().catch(() => {});
      else media.pause();
    };
    const removeTransportListeners = () => {
      media.removeEventListener("play", onPlay);
      media.removeEventListener("pause", onPause);
    };
    const cleanMediaSource = () => {
      media.pause();
      media.removeAttribute("src");
      media.load();
    };

    if (shouldUseNativeVideoHls(media.canPlayType("application/vnd.apple.mpegurl"), navigator.vendor)) {
      let nativeRecoveryUsed = false;
      let pendingRecovery: RecoverySnapshot | null = null;
      const onLoadedMetadata = () => {
        const snapshot = pendingRecovery;
        applyPosition(snapshot?.position ?? startPosition);
        if (!mediaReady) {
          mediaReady = true;
          pendingRecovery = null;
          recoveryActive = false;
          ready();
          return;
        }
        if (snapshot) {
          pendingRecovery = null;
          restoreRecovery(snapshot);
        }
      };
      const onError = () => {
        if (cancelled) return;
        if (nativeRecoveryUsed) {
          fatal();
          return;
        }
        nativeRecoveryUsed = true;
        pendingRecovery = recoverySnapshot();
        recoveryActive = true;
        media.src = src;
        media.load();
      };
      media.addEventListener("loadedmetadata", onLoadedMetadata);
      media.addEventListener("error", onError);
      media.src = src;
      media.load();
      return () => {
        cancelled = true;
        media.removeEventListener("loadedmetadata", onLoadedMetadata);
        media.removeEventListener("error", onError);
        removeTransportListeners();
        cleanMediaSource();
      };
    }

    void import("hls.js").then(({ default: Hls }) => {
      if (cancelled) return;
      if (!Hls.isSupported()) {
        fatal();
        return;
      }
      let networkRecoveryUsed = false;
      let mediaRecoveryUsed = false;
      let masterReloadUsed = false;
      let masterReloadPending = false;
      let sourceLoaded = false;
      let pendingRecovery: RecoverySnapshot | null = null;
      const instance = new Hls({
        autoStartLoad: false,
        backBufferLength: 60,
        enableWorker: true,
        lowLatencyMode: false,
        maxBufferLength: 30,
        maxBufferSize: 32 * 1024 * 1024,
        maxMaxBufferLength: 60,
        startPosition,
      });
      hls = instance;
      const restorePendingRecovery = () => {
        if (masterReloadPending) return;
        const snapshot = pendingRecovery;
        if (!snapshot) return;
        pendingRecovery = null;
        restoreRecovery(snapshot);
      };
      const onCanPlay = () => restorePendingRecovery();
      media.addEventListener("canplay", onCanPlay);
      detachHlsMediaListeners = () => media.removeEventListener("canplay", onCanPlay);
      instance.on(Hls.Events.MEDIA_ATTACHED, () => {
        if (sourceLoaded) return;
        sourceLoaded = true;
        instance.loadSource(src);
      });
      instance.on(Hls.Events.MANIFEST_PARSED, () => {
        if (mediaReady) {
          if (!masterReloadPending) return;
          masterReloadPending = false;
          instance.startLoad(pendingRecovery?.position ?? startPosition);
          return;
        }
        const initialPosition = pendingRecovery?.position ?? startPosition;
        pendingRecovery = null;
        recoveryActive = false;
        instance.startLoad(initialPosition);
        mediaReady = true;
        ready();
      });
      instance.on(Hls.Events.FRAG_BUFFERED, restorePendingRecovery);
      instance.on(Hls.Events.ERROR, (_event, data) => {
        if (cancelled) return;
        const action = videoHlsRecoveryAction({
          fatal: data.fatal,
          masterReloadPending,
          masterReloadUsed,
          mediaRecoveryUsed,
          networkRecoveryUsed,
          responseCode: data.response?.code,
          type: data.type,
        });
        if (action === "ignore") return;
        if (action === "reload-master") {
          masterReloadUsed = true;
          masterReloadPending = true;
          pendingRecovery = recoverySnapshot();
          recoveryActive = true;
          instance.stopLoad();
          instance.loadSource(src);
          return;
        }
        if (action === "restart-network") {
          networkRecoveryUsed = true;
          pendingRecovery = recoverySnapshot();
          recoveryActive = true;
          instance.startLoad(pendingRecovery.position);
          return;
        }
        if (action === "recover-media") {
          mediaRecoveryUsed = true;
          pendingRecovery = recoverySnapshot();
          recoveryActive = true;
          instance.recoverMediaError();
          if (pendingRecovery.position === 0) instance.startLoad(0);
          return;
        }
        detachHlsMediaListeners();
        instance.destroy();
        hls = null;
        fatal();
      });
      instance.attachMedia(media);
    }).catch(fatal);

    return () => {
      cancelled = true;
      hls?.destroy();
      detachHlsMediaListeners();
      removeTransportListeners();
      cleanMediaSource();
    };
  }, [active, durationSeconds, mediaRef, src, startSeconds]);
}
