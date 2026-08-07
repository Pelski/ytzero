/** Manual downloads are intentional; this preference controls automatic jobs. */
export function shouldAutoDownloadVideo(isShort: number | null, includeShorts: boolean): boolean {
  // Fail closed while classification is pending. Otherwise a scheduler tick
  // can enqueue a new upload in the gap between discovery and Shorts lookup.
  return includeShorts || isShort === 0;
}
