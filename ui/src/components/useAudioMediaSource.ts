import { useEffect, type RefObject } from "react";

export function useAudioMediaSource({
  audioRef,
  live,
  onFatalError,
  src,
}: {
  audioRef: RefObject<HTMLAudioElement | null>;
  live: boolean;
  onFatalError: () => void;
  src: string;
}): void {
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !live) return;
    let cancelled = false;
    let hls: import("hls.js").default | null = null;

    if (audio.canPlayType("application/vnd.apple.mpegurl")) {
      audio.src = src;
      audio.load();
      void audio.play().catch(() => {});
      return () => {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      };
    }

    void import("hls.js").then(({ default: Hls }) => {
      if (cancelled || !audioRef.current) return;
      if (!Hls.isSupported()) { onFatalError(); return; }
      const instance = new Hls({
        backBufferLength: 30,
        lowLatencyMode: true,
        maxBufferLength: 60,
      });
      hls = instance;
      instance.loadSource(src);
      instance.attachMedia(audioRef.current);
      instance.on(Hls.Events.MANIFEST_PARSED, () => { void audioRef.current?.play().catch(() => {}); });
      instance.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal || cancelled) return;
        instance.destroy();
        onFatalError();
      });
    }).catch(() => { if (!cancelled) onFatalError(); });

    return () => {
      cancelled = true;
      hls?.destroy();
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    };
  }, [audioRef, live, onFatalError, src]);
}
