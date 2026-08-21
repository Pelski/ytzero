import { existsSync, unlinkSync } from "node:fs";
import { getSetting, setSetting } from "./db";
import { invalidateYtdlpStatus, YTDLP, ytdlpStatus } from "./downloadConfig";
import { log } from "./logger";

export type YtdlpUpdateChannel = "stable" | "nightly";
export const YTDLP_UPDATE_INTERVAL_DAYS = [0, 1, 3, 7, 30] as const;

export interface YtdlpUpdateResult {
  channel: YtdlpUpdateChannel;
  previous_version: string | null;
  version: string | null;
  updated: boolean;
  message: string;
}

let updatePromise: Promise<YtdlpUpdateResult> | null = null;

/** Written by the container bootstrap only when it creates a new persistent
 * binary. It makes the first update honour the stored channel even when the
 * normal update schedule is disabled or has just run. */
export const YTDLP_PROVISION_MARKER = process.env.YTDLP_PROVISION_MARKER;
const YTDLP_MANAGED_PATH = process.env.YTDLP_MANAGED_PATH ?? "/data/bin/yt-dlp";

export function ytdlpProvisionReconciliationPending(): boolean {
  return YTDLP === YTDLP_MANAGED_PATH && Boolean(YTDLP_PROVISION_MARKER && existsSync(YTDLP_PROVISION_MARKER));
}

export function ytdlpUpdateChannel(): YtdlpUpdateChannel {
  return getSetting("ytdlp_update_channel") === "stable" ? "stable" : "nightly";
}

export function ytdlpUpdateIntervalDays(): number {
  const configured = getSetting("ytdlp_update_interval_days");
  if (configured == null) return process.env.YTDLP_AUTO_UPDATE === "1" ? 1 : 0;
  const days = Number(configured);
  return YTDLP_UPDATE_INTERVAL_DAYS.includes(days as (typeof YTDLP_UPDATE_INTERVAL_DAYS)[number]) ? days : 0;
}

export async function setYtdlpUpdateConfig(channel: unknown, intervalDays: unknown) {
  if (channel !== "stable" && channel !== "nightly") throw new Error("invalid yt-dlp update channel");
  const days = Number(intervalDays);
  if (!YTDLP_UPDATE_INTERVAL_DAYS.includes(days as (typeof YTDLP_UPDATE_INTERVAL_DAYS)[number])) throw new Error("invalid yt-dlp update interval");
  await setSetting("ytdlp_update_channel", channel);
  await setSetting("ytdlp_update_interval_days", String(days));
  return { channel, interval_days: days };
}

export async function ytdlpSelfUpdate(options: { force?: boolean } = {}): Promise<YtdlpUpdateResult | null> {
  const intervalDays = ytdlpUpdateIntervalDays();
  const reconciliationPending = ytdlpProvisionReconciliationPending();
  if (!options.force && !reconciliationPending) {
    if (intervalDays === 0) return null;
    const lastAttempt = Date.parse(getSetting("ytdlp_update_last_attempt_at") ?? "");
    if (Number.isFinite(lastAttempt) && Date.now() - lastAttempt < intervalDays * 24 * 60 * 60_000) return null;
  }
  if (updatePromise) return updatePromise;

  const channel = ytdlpUpdateChannel();
  updatePromise = (async () => {
    const previousVersion = await ytdlpStatus();
    await setSetting("ytdlp_update_last_attempt_at", new Date().toISOString());
    const proc = Bun.spawn([YTDLP, "--update-to", channel], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    invalidateYtdlpStatus();
    const version = await ytdlpStatus();
    const message = ((exitCode === 0 ? stdout.trim() || stderr.trim() : stderr.trim() || stdout.trim()) || (exitCode === 0 ? "yt-dlp is up to date" : "yt-dlp update failed")).slice(-2_000);
    if (exitCode !== 0) throw new Error(message);
    if (reconciliationPending && YTDLP_PROVISION_MARKER) unlinkSync(YTDLP_PROVISION_MARKER);
    log.info("downloads.ytdlp_updated", { channel, previousVersion, version, updated: previousVersion !== version });
    return { channel, previous_version: previousVersion, version, updated: previousVersion !== version, message };
  })();
  try {
    return await updatePromise;
  } finally {
    updatePromise = null;
  }
}
