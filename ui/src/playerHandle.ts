/**
 * Imperative playback surface shared by YouTube, LocalPlayer, and audio mode.
 * The numeric states mirror YT.Player: 0 ended, 1 playing, 2 paused, 3 buffering.
 */
export interface WatchPlayerHandle {
  destroy: () => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getIframe?: () => HTMLIFrameElement;
  getPlaybackRate: () => number;
  getPlayerState: () => number;
  getVolume?: () => number;
  isMuted?: () => boolean;
  mute?: () => void;
  pauseVideo: () => void;
  playVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  setPlaybackRate: (rate: number) => void;
  setVolume?: (volume: number) => void;
  unMute?: () => void;
}
