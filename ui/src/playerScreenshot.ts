export type PlayerScreenshotFormat = "jpeg" | "png" | "webp";

export const DEFAULT_SCREENSHOT_FILENAME_TEMPLATE = "{channel}_{title}_{timestamp_ms}";

export const SCREENSHOT_FORMATS: Record<PlayerScreenshotFormat, { mime: string; extension: string }> = {
  jpeg: { mime: "image/jpeg", extension: "jpg" },
  png: { mime: "image/png", extension: "png" },
  webp: { mime: "image/webp", extension: "webp" },
};

export function parsePlayerScreenshotFormat(value: string | null | undefined): PlayerScreenshotFormat {
  return value === "png" || value === "webp" ? value : "jpeg";
}

export function formatScreenshotTimestamp(seconds: number, milliseconds = false): string {
  const totalMs = Math.max(0, Math.floor((Number.isFinite(seconds) ? seconds : 0) * 1000));
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const wholeSeconds = Math.floor((totalMs % 60_000) / 1000);
  const millis = totalMs % 1000;
  const base = [hours, minutes, wholeSeconds].map((part) => String(part).padStart(2, "0")).join("-");
  return milliseconds ? `${base}-${String(millis).padStart(3, "0")}` : base;
}

function safeFilenamePart(value: string, fallback: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  return cleaned || fallback;
}

export function buildScreenshotFilename(input: {
  template?: string | null;
  channel?: string | null;
  title?: string | null;
  videoId?: string | null;
  seconds: number;
  format: PlayerScreenshotFormat;
}): string {
  const values: Record<string, string> = {
    channel: safeFilenamePart(input.channel ?? "", "Channel"),
    title: safeFilenamePart(input.title ?? "", "Video"),
    video_id: safeFilenamePart(input.videoId ?? "", "video"),
    timestamp: formatScreenshotTimestamp(input.seconds),
    timestamp_ms: formatScreenshotTimestamp(input.seconds, true),
  };
  const template = input.template?.trim() || DEFAULT_SCREENSHOT_FILENAME_TEMPLATE;
  const rendered = template.replace(/\{(channel|title|video_id|timestamp|timestamp_ms)\}/g, (_, key: string) => values[key]);
  const base = safeFilenamePart(rendered, `Screenshot_${values.timestamp_ms}`).slice(0, 180).replace(/[. ]+$/g, "");
  return `${base}.${SCREENSHOT_FORMATS[input.format].extension}`;
}

export async function downloadScreenshotCanvas(
  canvas: HTMLCanvasElement,
  input: Parameters<typeof buildScreenshotFilename>[0],
): Promise<void> {
  const output = SCREENSHOT_FORMATS[input.format];
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (value) => value ? resolve(value) : reject(new Error("frame encoding failed")),
      output.mime,
      input.format === "png" ? undefined : 0.92,
    );
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = buildScreenshotFilename(input);
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
