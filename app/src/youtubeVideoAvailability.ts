export class PrivateVideoError extends Error {
  readonly code = "PRIVATE_VIDEO";

  constructor(message = "Private video") {
    super(message);
    this.name = "PrivateVideoError";
  }
}

export class DeletedVideoError extends Error {
  readonly code = "DELETED_VIDEO";

  constructor(message = "Video unavailable") {
    super(message);
    this.name = "DeletedVideoError";
  }
}

export function isPrivateVideoError(error: unknown): boolean {
  return error instanceof PrivateVideoError
    || (error instanceof Error && /\bprivate video\b/i.test(error.message));
}

export function isDeletedVideoError(error: unknown): boolean {
  return error instanceof DeletedVideoError
    || (error instanceof Error && /\b(?:video unavailable|video (?:has been|was) removed|removed by (?:the )?uploader)\b/i.test(error.message));
}

export type VideoOEmbedAvailability = "available" | "unavailable" | "unknown";

export function videoOEmbedAvailabilityFromStatus(status: number): VideoOEmbedAvailability {
  if (status >= 200 && status < 300) return "available";
  if (status === 401 || status === 403 || status === 404) return "unavailable";
  return "unknown";
}

export async function fetchVideoOEmbedAvailability(
  videoId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<VideoOEmbedAvailability> {
  const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  const response = await fetchImpl(
    `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`,
    { headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "en-US,en;q=0.9" } },
  );
  if (response.status === 429) throw new Error("YouTube oEmbed availability failed (429)");
  await response.body?.cancel().catch(() => {});
  return videoOEmbedAvailabilityFromStatus(response.status);
}
