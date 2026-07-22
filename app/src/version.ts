// Baked in by the Docker build (YTZERO_VERSION / YTZERO_COMMIT build args) and
// by scripts/install.sh; when running straight from a checkout the commit is
// resolved from git so dev logs carry it too.
export const VERSION = process.env.YTZERO_VERSION || "dev";

function detectCommit(): string {
  const env = process.env.YTZERO_COMMIT;
  if (env && env !== "unknown") return env;
  try {
    const proc = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: import.meta.dir });
    const out = proc.stdout.toString().trim();
    if (proc.success && /^[0-9a-f]{7,40}$/.test(out)) return out;
  } catch {
    // git absent (e.g. release tarball) — fall through.
  }
  return "unknown";
}

/** Short commit hash the running build was made from, or "unknown". */
export const COMMIT = detectCommit().slice(0, 7);

interface ParsedVersion {
  parts: [number, number, number];
  prerelease: boolean;
}

function parseVersion(value: string): ParsedVersion | null {
  const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(-.+)?$/);
  if (!match) return null;
  return {
    parts: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: Boolean(match[4]),
  };
}

/** Whether a stable GitHub release is newer than the running build. `null`
 * means the local label (for example `dev` or `edge`) is not comparable. */
export function isReleaseNewer(current: string, latest: string): boolean | null {
  const a = parseVersion(current);
  const b = parseVersion(latest);
  if (!a || !b) return null;
  for (let index = 0; index < a.parts.length; index++) {
    if (b.parts[index] !== a.parts[index]) return b.parts[index] > a.parts[index];
  }
  return a.prerelease && !b.prerelease;
}
