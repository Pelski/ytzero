import { db, getUserSetting } from "./db";
import { log } from "./logger";
import { COMMIT, isReleaseNewer, VERSION } from "./version";
import { createNotification } from "./notifications";

export interface UpdateCheckResult {
  currentVersion: string;
  commit: string;
  latestVersion: string | null;
  updateAvailable: boolean | null;
  checkedAt: string;
  latestUrl: string;
  publishedAt: string;
}

interface GitHubRelease {
  tag_name?: unknown;
  published_at?: unknown;
  html_url?: unknown;
}

export async function checkLatestRelease(): Promise<UpdateCheckResult> {
  const response = await fetch("https://api.github.com/repos/Pelski/ytzero/releases/latest", {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "YT-Zero-update-check",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
  const release = await response.json() as GitHubRelease;
  const latestVersion = typeof release.tag_name === "string" ? release.tag_name : null;
  return {
    currentVersion: VERSION,
    commit: COMMIT,
    latestVersion,
    updateAvailable: latestVersion ? isReleaseNewer(VERSION, latestVersion) : null,
    checkedAt: new Date().toISOString(),
    latestUrl: typeof release.html_url === "string" ? release.html_url : "https://github.com/Pelski/ytzero/releases/latest",
    publishedAt: typeof release.published_at === "string" ? release.published_at : "",
  };
}

const INTERVAL_HOURS = new Set([1, 3, 6, 12, 24, 72, 168]);
let automaticCheckRunning = false;

export async function runAutomaticUpdateChecks(): Promise<void> {
  if (automaticCheckRunning) return;
  const now = Date.now();
  const dueUsers = (db.prepare(`
    SELECT u.id, s.last_checked_at
    FROM users u
    LEFT JOIN update_check_state s ON s.user_id = u.id
  `).all() as { id: number; last_checked_at: string | null }[]).filter((user) => {
    const hours = Number(getUserSetting(user.id, "update_check_interval"));
    if (!INTERVAL_HOURS.has(hours)) return false;
    const last = user.last_checked_at ? Date.parse(`${user.last_checked_at.replace(" ", "T")}Z`) : 0;
    return !Number.isFinite(last) || now - last >= hours * 60 * 60_000;
  });
  if (dueUsers.length === 0) return;

  automaticCheckRunning = true;
  const markChecked = db.prepare(`
    INSERT INTO update_check_state (user_id, last_checked_at) VALUES (?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET last_checked_at = excluded.last_checked_at
  `);
  try {
    // Mark attempts even when GitHub is unavailable, otherwise the five-minute
    // scheduler would hammer the endpoint until it succeeds.
    for (const user of dueUsers) markChecked.run(user.id);
    const result = await checkLatestRelease();
    if (result.updateAvailable && result.latestVersion) {
      const payload = { version: result.latestVersion, url: result.latestUrl, publishedAt: result.publishedAt };
      for (const user of dueUsers) createNotification(user.id, "app_update", `app_update:${result.latestVersion}`, payload, "/settings?tab=advanced&section=changelog");
    }
    log.info("updates.automatic_check", { profiles: dueUsers.length, latestVersion: result.latestVersion, updateAvailable: result.updateAvailable });
  } catch (error) {
    log.warn("updates.automatic_check_failed", { profiles: dueUsers.length, error: error instanceof Error ? error.message : String(error) });
  } finally {
    automaticCheckRunning = false;
  }
}
