let ytApiReady: Promise<void> | null = null;

export function loadYouTubeApi(): Promise<void> {
  if (!ytApiReady) {
    ytApiReady = new Promise<void>((resolve) => {
      const target = window as typeof window & { YT?: { Player?: unknown }; onYouTubeIframeAPIReady?: () => void };
      if (target.YT?.Player) {
        resolve();
        return;
      }
      const previousReadyHandler = target.onYouTubeIframeAPIReady;
      target.onYouTubeIframeAPIReady = () => {
        previousReadyHandler?.();
        resolve();
      };
      if (!document.querySelector('script[src*="iframe_api"]')) {
        const script = document.createElement("script");
        script.src = "https://www.youtube.com/iframe_api";
        document.head.appendChild(script);
      }
    });
  }
  return ytApiReady;
}

export function colonDurationToSeconds(duration: string | null | undefined): number | undefined {
  if (!duration) return undefined;
  const parts = duration.trim().split(":");
  if (parts.length < 2 || parts.length > 3 || !parts.every((part) => /^\d+$/.test(part))) return undefined;
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}

export function restoreSidebarVisibility(): void {
  document.body.classList.remove("cinema");
  document.body.classList.toggle("sidebar-hidden", localStorage.getItem("sidebar_open") === "0");
}

export function formatWatchTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}
