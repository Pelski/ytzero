/** Manual downloads are intentional; this preference controls automatic jobs. */
export function shouldAutoDownloadVideo(isShort: number | null, includeShorts: boolean): boolean {
  return isShort !== 1 || includeShorts;
}
