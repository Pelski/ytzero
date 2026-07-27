import { getUserSetting } from "./db";
import { database } from "./database";
import { log } from "./logger";
import { COMMIT, isReleaseNewer, VERSION } from "./version";
import { createNotification } from "./notifications";
import { parseGitHubReleases, releasesNewerThan, type GitHubReleaseSummary } from "./githubReleases";

export interface UpdateCheckResult {
  currentVersion: string;
  commit: string;
  latestVersion: string | null;
  updateAvailable: boolean | null;
  checkedAt: string;
  latestUrl: string;
  publishedAt: string;
  releases: GitHubReleaseSummary[];
  availableReleases: GitHubReleaseSummary[];
}

const RELEASES_URL = "https://api.github.com/repos/Pelski/ytzero/releases?per_page=10";
const RELEASES_FALLBACK_URL = "https://github.com/Pelski/ytzero/releases";
const CACHE_MS = 15 * 60_000;
let cachedResult: { expiresAt: number; value: UpdateCheckResult } | null = null;
let pendingCheck: Promise<UpdateCheckResult> | null = null;

async function fetchLatestReleases(): Promise<UpdateCheckResult> {
  const response = await fetch(RELEASES_URL, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "YT-Zero-update-check",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
  const releases = parseGitHubReleases(await response.json());
  const latest = releases[0] ?? null;
  const latestVersion = latest?.version ?? null;
  return {
    currentVersion: VERSION,
    commit: COMMIT,
    latestVersion,
    updateAvailable: latestVersion ? isReleaseNewer(VERSION, latestVersion) : null,
    checkedAt: new Date().toISOString(),
    latestUrl: latest?.url ?? RELEASES_FALLBACK_URL,
    publishedAt: latest?.publishedAt ?? "",
    releases,
    availableReleases: releasesNewerThan(VERSION, releases),
  };
}

export async function checkLatestRelease(): Promise<UpdateCheckResult> {
  if (cachedResult && cachedResult.expiresAt > Date.now()) return cachedResult.value;
  if (pendingCheck) return pendingCheck;
  pendingCheck = fetchLatestReleases().then((value) => {
    cachedResult = { expiresAt: Date.now() + CACHE_MS, value };
    return value;
  }).finally(() => { pendingCheck = null; });
  return pendingCheck;
}

const INTERVAL_HOURS = new Set([1, 3, 6, 12, 24, 72, 168]);
let automaticCheckRunning = false;

export async function runAutomaticUpdateChecks(): Promise<void> {
  if (automaticCheckRunning) return;
  const now = Date.now();
  const dueUsers = (await database.prepare(`
    SELECT u.id, s.last_checked_at
    FROM users u
    LEFT JOIN update_check_state s ON s.user_id = u.id
  `).all<{ id: number; last_checked_at: string | null }>()).filter((user) => {
    const hours = Number(getUserSetting(user.id, "update_check_interval"));
    if (!INTERVAL_HOURS.has(hours)) return false;
    const last = user.last_checked_at ? Date.parse(`${user.last_checked_at.replace(" ", "T")}Z`) : 0;
    return !Number.isFinite(last) || now - last >= hours * 60 * 60_000;
  });
  if (dueUsers.length === 0) return;

  automaticCheckRunning = true;
  const markChecked = database.prepare(`
    INSERT INTO update_check_state (user_id, last_checked_at) VALUES (?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET last_checked_at = excluded.last_checked_at
  `);
  try {
    // Mark attempts even when GitHub is unavailable, otherwise the five-minute
    // scheduler would hammer the endpoint until it succeeds.
    for (const user of dueUsers) await markChecked.run(user.id);
    const result = await checkLatestRelease();
    if (result.updateAvailable && result.latestVersion) {
      const payload = { version: result.latestVersion, url: result.latestUrl, publishedAt: result.publishedAt };
      for (const user of dueUsers) await createNotification(user.id, "app_update", `app_update:${result.latestVersion}`, payload, "/settings?tab=advanced&section=changelog");
    }
    log.info("updates.automatic_check", { profiles: dueUsers.length, latestVersion: result.latestVersion, updateAvailable: result.updateAvailable });
  } catch (error) {
    log.warn("updates.automatic_check_failed", { profiles: dueUsers.length, error: error instanceof Error ? error.message : String(error) });
  } finally {
    automaticCheckRunning = false;
  }
}
