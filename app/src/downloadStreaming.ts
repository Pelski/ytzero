import { createAudioStreamingControls } from "./audioStreamingControls";
import { createDownloadAudioStreaming } from "./downloadAudioStreaming";
import { createDownloadLiveAudioStreaming } from "./downloadLiveAudioStreaming";
import { createDownloadVideoStreaming } from "./downloadVideoStreaming";
import type { DlSettings } from "./downloader";

interface DownloadStreamingDependencies {
  DOWNLOADS_DIR: string;
  YTDLP: string;
  dlEnabled: (userId?: number) => Promise<boolean>;
  dlSettings: (userId?: number) => Promise<DlSettings>;
  downloadCookiesConfigured: (userId: number) => boolean;
  downloadCookiesFile: (userId: number) => string;
  prioritizeDownload: (userId: number, videoId: string) => Promise<boolean>;
  readLines: (stream: ReadableStream<Uint8Array>, onLine: (line: string) => void) => Promise<void>;
  ytdlpStatus: () => Promise<string | null>;
  audioDiagnostic?: import("./audioDiagnostics").AudioDiagnostic;
  fetchImpl?: typeof fetch;
  spawn?: typeof Bun.spawn;
}

export function createDownloadStreaming(dependencies: DownloadStreamingDependencies) {
  const videoStreaming = createDownloadVideoStreaming(dependencies);
  const audioStreaming = createDownloadAudioStreaming(dependencies);
  const liveAudioStreaming = createDownloadLiveAudioStreaming(dependencies);
  const audioSourceControls = createAudioStreamingControls(audioStreaming, liveAudioStreaming);
  return {
    ...videoStreaming,
    ...audioStreaming,
    ...liveAudioStreaming,
    ...audioSourceControls,
  };
}
