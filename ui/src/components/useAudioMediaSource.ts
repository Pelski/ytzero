import { useEffect, type RefObject } from "react";
import { shouldFallbackFromHlsJs, shouldFallbackFromNativeHls } from "../audioMediaSourcePolicy";

export function useAudioMediaSource({
  audioRef,
  live,
  onFatalError,
  playlistSrc,
  progressiveSrc,
}: {
  audioRef: RefObject<HTMLAudioElement | null>;
  live: boolean;
  onFatalError: () => void;
  playlistSrc: string;
  progressiveSrc?: string;
}): void {
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    let cancelled = false;
    let hls: import("hls.js").default | null = null;
    let source: "hls-js" | "native-hls" | "progressive" = "native-hls";
    let sourceReady = false;
    let networkRecoveryUsed = false;
    let mediaRecoveryUsed = false;

    const tryPlay = () => { void audio.play().catch(() => {}); };
    const fatal = () => { if (!cancelled) onFatalError(); };
    const attachProgressive = (): boolean => {
      if (live || !progressiveSrc || cancelled) return false;
      source = "progressive";
      sourceReady = false;
      hls?.destroy();
      hls = null;
      audio.src = progressiveSrc;
      audio.load();
      tryPlay();
      return true;
    };
    const onLoadedMetadata = () => { sourceReady = true; };
    const onMediaError = () => {
      if (cancelled || source === "hls-js") return;
      if (source === "native-hls" && shouldFallbackFromNativeHls({
        hasProgressiveSource: Boolean(progressiveSrc), live, sourceReady,
      }) && attachProgressive()) return;
      fatal();
    };

    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("error", onMediaError);

    if (audio.canPlayType("application/vnd.apple.mpegurl")) {
      audio.src = playlistSrc;
      audio.load();
      tryPlay();
      return () => {
        cancelled = true;
        audio.removeEventListener("loadedmetadata", onLoadedMetadata);
        audio.removeEventListener("error", onMediaError);
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      };
    }

    void import("hls.js").then(({ default: Hls }) => {
      if (cancelled || !audioRef.current) return;
      if (!Hls.isSupported()) {
        if (!attachProgressive()) fatal();
        return;
      }
      const instance = new Hls({
        backBufferLength: 30,
        lowLatencyMode: live,
        maxBufferLength: 30,
        maxBufferSize: 8 * 1024 * 1024,
        maxMaxBufferLength: 60,
      });
      hls = instance;
      source = "hls-js";
      instance.loadSource(playlistSrc);
      instance.attachMedia(audioRef.current);
      instance.on(Hls.Events.MANIFEST_PARSED, () => {
        sourceReady = true;
        void audioRef.current?.play().catch(() => {});
      });
      instance.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal || cancelled) return;
        if (shouldFallbackFromHlsJs({
          hasProgressiveSource: Boolean(progressiveSrc), live, sourceReady, status: data.response?.code,
        }) && attachProgressive()) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && !networkRecoveryUsed) {
          networkRecoveryUsed = true;
          instance.startLoad();
          return;
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !mediaRecoveryUsed) {
          mediaRecoveryUsed = true;
          instance.recoverMediaError();
          return;
        }
        instance.destroy();
        hls = null;
        fatal();
      });
    }).catch(() => {
      if (!cancelled && !attachProgressive()) fatal();
    });

    return () => {
      cancelled = true;
      hls?.destroy();
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("error", onMediaError);
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    };
  }, [audioRef, live, onFatalError, playlistSrc, progressiveSrc]);
}
