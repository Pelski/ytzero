import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function provision(env: Record<string, string>) {
  const child = Bun.spawn(["sh", "app/scripts/provision-ytdlp.sh", "sh", "-c", "true"], {
    cwd: resolve(import.meta.dir, "../.."), env: { ...Bun.env, ...env }, stdout: "pipe", stderr: "pipe",
  });
  return child.exited;
}

describe("container yt-dlp provisioning", () => {
  test("initializes a missing managed binary and leaves an existing binary unchanged", async () => {
    const root = mkdtempSync(join(tmpdir(), "ytzero-ytdlp-provision-test-")); roots.push(root);
    const bootstrap = join(root, "bootstrap");
    const managed = join(root, "bin", "yt-dlp");
    const marker = join(root, "bin", ".pending");
    writeFileSync(bootstrap, "stable"); chmodSync(bootstrap, 0o755);
    const env = { YTDLP_MANAGED_PATH: managed, YTDLP_BOOTSTRAP_PATH: bootstrap, YTDLP_PROVISION_MARKER: marker };
    expect(await provision(env)).toBe(0);
    expect(readFileSync(managed, "utf8")).toBe("stable");
    expect(existsSync(marker)).toBe(true);
    writeFileSync(managed, "nightly");
    writeFileSync(bootstrap, "new stable");
    expect(await provision(env)).toBe(0);
    expect(readFileSync(managed, "utf8")).toBe("nightly");
  });

  test("does not provision when an operator supplies a custom YTDLP_PATH", async () => {
    const root = mkdtempSync(join(tmpdir(), "ytzero-ytdlp-provision-test-")); roots.push(root);
    const bootstrap = join(root, "bootstrap");
    const managed = join(root, "bin", "yt-dlp");
    const marker = join(root, "bin", ".pending");
    writeFileSync(bootstrap, "stable");
    expect(await provision({ YTDLP_MANAGED_PATH: managed, YTDLP_PATH: join(root, "custom-yt-dlp"), YTDLP_BOOTSTRAP_PATH: bootstrap, YTDLP_PROVISION_MARKER: marker })).toBe(0);
    expect(existsSync(managed)).toBe(false);
    expect(existsSync(marker)).toBe(false);
  });
});
