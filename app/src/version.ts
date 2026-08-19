// The pipeline stamps app/src/VERSION and app/src/COMMIT before the build
// starts, so both labels travel with the sources into the image, the release
// tarball and the native install without a build arg. YTZERO_VERSION and
// YTZERO_COMMIT stay the fallback for unstamped builds (docker run -e, the
// scripts/install.sh env file, a plain checkout), and the commit is still
// resolved from git after that so dev logs carry it too.
import { readFileSync } from "node:fs";

const COMMIT_HASH = /^[0-9a-f]{7,40}$/;

/** Reads a stamp the pipeline wrote next to these sources, if it is there. */
function readStamp(name: string): string | null {
  try {
    return readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
  } catch {
    return null; // Unstamped build — the env var decides.
  }
}

/** Label the running build reports: a stamped file wins over the env var. */
export function pickBuildVersion(file: string | null, env: string | undefined): string {
  return file?.trim() || env?.trim() || "dev";
}

/** Commit the running build was made from: stamp, then env var, then git.
 * Values that are not commit hashes are ignored, so a truncated stamp or the
 * "unknown" placeholder the Docker build defaults to cannot mask a real hash. */
export function pickBuildCommit(file: string | null, env: string | undefined, git: () => string | null): string {
  const stamped = [file, env].map((value) => value?.trim()).find((value) => value && COMMIT_HASH.test(value));
  if (stamped) return stamped;
  const head = git()?.trim(); // Only spawned when nothing was baked in.
  return head && COMMIT_HASH.test(head) ? head : "unknown";
}

function gitHead(): string | null {
  try {
    const proc = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: import.meta.dir });
    return proc.success ? proc.stdout.toString() : null;
  } catch {
    return null; // git absent (e.g. release tarball).
  }
}

export const VERSION = pickBuildVersion(readStamp("VERSION"), process.env.YTZERO_VERSION);

/** Short commit hash the running build was made from, or "unknown". */
export const COMMIT = pickBuildCommit(readStamp("COMMIT"), process.env.YTZERO_COMMIT, gitHead).slice(0, 7);

interface ParsedVersion {
  scheme: "legacy" | "calver";
  parts: [string, string, string];
  canonical: string;
}

function compareNumericParts(left: string, right: string): -1 | 0 | 1 {
  if (left.length !== right.length) return left.length > right.length ? 1 : -1;
  if (left === right) return 0;
  return left > right ? 1 : -1;
}

function parseVersion(value: string): ParsedVersion | null {
  // Release tags use a deliberately narrow grammar. In particular, accepting
  // arbitrary three-number strings here would make malformed CalVer tags such
  // as 2026.8.1 look like valid SemVer releases.
  const calver = value.match(/^([1-9]\d{3})\.(0[1-9]|1[0-2])\.([1-9]\d*)$/);
  if (calver) {
    return {
      scheme: "calver",
      parts: [calver[1], calver[2], calver[3]],
      canonical: value,
    };
  }

  const legacy = value.match(/^v?0\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  if (legacy) {
    const canonical = `0.${legacy[1]}.${legacy[2]}`;
    return {
      scheme: "legacy",
      parts: ["0", legacy[1], legacy[2]],
      canonical,
    };
  }

  return null;
}

/** A stable identity for supported release labels, or `null` for malformed
 * labels. Historical `v0.x.y` and `0.x.y` tags share the same key. */
export function canonicalVersionKey(value: string): string | null {
  return parseVersion(value)?.canonical ?? null;
}

/** Compare two supported release labels. A positive result means `left` is
 * newer. Every CalVer release follows every historical 0.x.y release. */
export function compareVersions(left: string, right: string): -1 | 0 | 1 | null {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return null;

  if (a.scheme !== b.scheme) return a.scheme === "calver" ? 1 : -1;
  for (let index = 0; index < a.parts.length; index++) {
    const comparison = compareNumericParts(a.parts[index], b.parts[index]);
    if (comparison !== 0) return comparison;
  }
  return 0;
}

/** Whether a stable GitHub release is newer than the running build. `null`
 * means the local label (for example `dev` or `edge`) is not comparable. */
export function isReleaseNewer(current: string, latest: string): boolean | null {
  const comparison = compareVersions(latest, current);
  return comparison === null ? null : comparison > 0;
}
