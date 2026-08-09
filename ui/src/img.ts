// Route YouTube image URLs through the backend cache/proxy so they are stored
// locally and survive origin rate-limiting (HTTP 429).
export function img(url: string | null | undefined, options?: { onMiss?: "error" }): string {
  if (!url) return "";
  if (!/^https?:\/\//.test(url)) return url;
  const proxyUrl = `/api/img?u=${encodeURIComponent(url)}`;
  return options?.onMiss === "error" ? `${proxyUrl}&onMiss=error` : proxyUrl;
}
