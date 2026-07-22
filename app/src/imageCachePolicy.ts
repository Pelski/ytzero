const ALLOWED_IMAGE_HOSTS = ["ytimg.com", "ggpht.com", "googleusercontent.com", "youtube.com"];

export function isAllowedRemoteImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return ALLOWED_IMAGE_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  } catch {
    return false;
  }
}

export function videoIdFromThumbnailUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !(url.hostname === "i.ytimg.com" || url.hostname.endsWith(".ytimg.com"))) return null;
    const match = url.pathname.match(/^\/vi(?:_webp)?\/([^/]+)\//);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

export function isValidImagePayload(contentType: string, bytes: Uint8Array): boolean {
  if (!contentType.toLowerCase().startsWith("image/") || bytes.length < 32) return false;
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes[0] === 0x89 && ascii(bytes, 1, 3) === "PNG";
  const gif = ascii(bytes, 0, 3) === "GIF";
  const webp = ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP";
  const avif = ascii(bytes, 4, 4) === "ftyp" && ["avif", "avis"].includes(ascii(bytes, 8, 4));
  return jpeg || png || gif || webp || avif;
}
