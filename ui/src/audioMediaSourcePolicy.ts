export function shouldFallbackFromHlsJs({
  hasProgressiveSource,
  live,
  sourceReady,
  status,
}: {
  hasProgressiveSource: boolean;
  live: boolean;
  sourceReady: boolean;
  status: number | undefined;
}): boolean {
  return hasProgressiveSource && !live && !sourceReady && status === 404;
}

export function shouldFallbackFromNativeHls({
  hasProgressiveSource,
  live,
  sourceReady,
}: {
  hasProgressiveSource: boolean;
  live: boolean;
  sourceReady: boolean;
}): boolean {
  // Native media errors do not expose the manifest HTTP status. Falling back
  // is safe only before HLS has produced metadata; later errors belong to an
  // already selected source and must surface through the normal retry flow.
  return hasProgressiveSource && !live && !sourceReady;
}
