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
