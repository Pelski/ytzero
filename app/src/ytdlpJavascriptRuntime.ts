const MINIMUM_DENO_MAJOR = 2;
const MINIMUM_DENO_MINOR = 3;

/** Return a supported Deno version from `deno --version`, otherwise null. */
export function supportedDenoVersion(output: string): string | null {
  const match = output.match(/^deno\s+(\d+)\.(\d+)\.(\d+)/im);
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (major < MINIMUM_DENO_MAJOR || (major === MINIMUM_DENO_MAJOR && minor < MINIMUM_DENO_MINOR)) return null;
  return `${major}.${minor}.${Number(match[3])}`;
}
