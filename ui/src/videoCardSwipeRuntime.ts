import type { VideoCardSwipeDevice } from "./videoCardSwipeConfig";

const DEFAULT_SWIPE_DEVICES = '{"version":1,"devices":["desktop","tablet","mobile"]}';

export function applyVideoCardSwipeConfig(value: string) { document.documentElement.dataset.videoCardSwipeDevices = value || DEFAULT_SWIPE_DEVICES; }
export function readVideoCardSwipeConfig() { return document.documentElement.dataset.videoCardSwipeDevices || DEFAULT_SWIPE_DEVICES; }

export function classifyVideoCardSwipeDevice(coarsePointer: boolean, screenWidth: number, screenHeight: number): VideoCardSwipeDevice {
  if (!coarsePointer) return "desktop";
  const shortestSide = Math.min(screenWidth, screenHeight);
  return shortestSide <= 600 ? "mobile" : shortestSide <= 1024 ? "tablet" : "desktop";
}

export function videoCardSwipeEnabled(): boolean {
  const device = classifyVideoCardSwipeDevice(window.matchMedia("(any-pointer: coarse)").matches, window.screen.width, window.screen.height);
  return readVideoCardSwipeConfig().includes(`"${device}"`);
}
