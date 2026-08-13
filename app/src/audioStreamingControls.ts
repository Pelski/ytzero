interface AudioStreaming {
  invalidateAudioSources: (userId: number) => void;
  retryAudioSource: (userId: number, videoId: string, signal?: AbortSignal) => Promise<boolean>;
}

interface LiveAudioStreaming {
  invalidateLiveAudioSources: (userId: number) => void;
  retryLiveAudioSource: (userId: number, videoId: string, signal?: AbortSignal) => Promise<boolean>;
}

export function createAudioStreamingControls(audio: AudioStreaming, liveAudio: LiveAudioStreaming) {
  const invalidateAudioSources = (userId: number) => {
    audio.invalidateAudioSources(userId);
    liveAudio.invalidateLiveAudioSources(userId);
  };
  const retryAudioSource = (userId: number, videoId: string, live: boolean, signal?: AbortSignal) => live
    ? liveAudio.retryLiveAudioSource(userId, videoId, signal)
    : audio.retryAudioSource(userId, videoId, signal);
  return { invalidateAudioSources, retryAudioSource };
}
