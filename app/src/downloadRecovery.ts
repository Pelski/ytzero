import { existsSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { database } from "./database";
import { log } from "./logger";

export const DOWNLOAD_MANIFEST_SUFFIX = ".ytz.json";
const MEDIA_EXTENSIONS = new Set([".mp4", ".mkv", ".webm", ".mov", ".m4v"]);

interface DownloadManifest {
  schemaVersion: 1;
  videoId: string;
  /** Relative to the manifest. Never an absolute host path. */
  file: string;
  sizeBytes: number;
  downloadedAt: string;
}

interface RecoverableDownload {
  video_id: string;
  status: string;
  path: string | null;
}

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
  return out;
}

function isSafeRelativePath(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 1_024) return false;
  if (value.includes("\\") || value.startsWith("/") || value.split("/").some((part) => !part || part === "." || part === "..")) return false;
  return true;
}

export function downloadManifestPath(filePath: string): string {
  const extension = extname(filePath);
  const mediaBase = extension ? basename(filePath, extension) : basename(filePath);
  return join(dirname(filePath), `${mediaBase}${DOWNLOAD_MANIFEST_SUFFIX}`);
}

export function writeDownloadManifest(videoId: string, filePath: string, sizeBytes: number): string {
  const manifest: DownloadManifest = {
    schemaVersion: 1,
    videoId,
    file: basename(filePath),
    sizeBytes,
    downloadedAt: new Date().toISOString(),
  };
  const path = downloadManifestPath(filePath);
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(manifest)}\n`);
  renameSync(temporaryPath, path);
  return path;
}

async function recoverRow(row: RecoverableDownload, filePath: string, source: "manifest" | "filename", onRecovered: (videoId: string) => void) {
  const size = statSync(filePath).size;
  await database.prepare(`
    UPDATE downloads
    SET status='done', path=?, size_bytes=?, error=NULL, finished_at=COALESCE(finished_at, datetime('now'))
    WHERE video_id=? AND status IN ('done', 'deleted')
  `).run(filePath, size, row.video_id);
  if (source === "filename") writeDownloadManifest(row.video_id, filePath, size);
  onRecovered(row.video_id);
  log.info(source === "manifest" ? "downloads.recovered_from_manifest" : "downloads.recovered_from_filename", { videoId: row.video_id, path: filePath });
}

/**
 * Reconnect moved downloads before retention runs. Current manifests are
 * authoritative; legacy files without one are accepted only when exactly one
 * known video id occurs in exactly one media path.
 */
export async function recoverDownloadsFromDisk(downloadsDir: string, onRecovered: (videoId: string) => void = () => {}) {
  const root = resolve(downloadsDir);
  const allFiles = walkFiles(downloadsDir);
  const rows = await database.prepare(`
    SELECT video_id,status,path FROM downloads
    WHERE status IN ('done','deleted')
  `).all() as RecoverableDownload[];
  const byId = new Map(rows.map((row) => [row.video_id, row]));
  const claimedMedia = new Set<string>();
  const recoveredVideoIds = new Set<string>();
  let recovered = 0;
  let manifestsBackfilled = 0;

  for (const manifestPath of allFiles.filter((path) => path.endsWith(DOWNLOAD_MANIFEST_SUFFIX))) {
    let value: Partial<DownloadManifest>;
    try { value = JSON.parse(await Bun.file(manifestPath).text()); } catch { continue; }
    if (value.schemaVersion !== 1 || typeof value.videoId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value.videoId) || !isSafeRelativePath(value.file)) continue;
    const filePath = resolve(dirname(manifestPath), value.file);
    if (!filePath.startsWith(`${root}/`) || !existsSync(filePath)) continue;
    const groupedManifestPath = downloadManifestPath(filePath);
    if (manifestPath !== groupedManifestPath && !existsSync(groupedManifestPath)) {
      try { renameSync(manifestPath, groupedManifestPath); } catch { /* legacy name remains readable */ }
    }
    claimedMedia.add(filePath);
    const row = byId.get(value.videoId);
    if (!row || (row.status === "done" && row.path && resolve(row.path) === filePath)) continue;
    try {
      await recoverRow(row, filePath, "manifest", onRecovered);
      recovered++;
      recoveredVideoIds.add(row.video_id);
    } catch (error) {
      log.warn("downloads.manifest_recovery_failed", { videoId: row.video_id, error: error instanceof Error ? error.message : String(error) });
    }
  }

  // Older healthy downloads predate recovery manifests. Add their missing
  // sidecar in place so a later directory move remains recoverable without a
  // re-download. Never replace an existing file: an unreadable or conflicting
  // sidecar needs explicit inspection rather than silently losing its data.
  for (const row of rows) {
    if (row.status !== "done" || !row.path) continue;
    const filePath = resolve(row.path);
    if (!filePath.startsWith(`${root}/`) || claimedMedia.has(filePath) || !MEDIA_EXTENSIONS.has(extname(filePath).toLowerCase()) || !existsSync(filePath)) continue;
    const manifestPath = downloadManifestPath(filePath);
    if (existsSync(manifestPath)) {
      log.warn("downloads.manifest_backfill_conflict", { videoId: row.video_id, path: manifestPath });
      continue;
    }
    try {
      const fileStat = statSync(filePath);
      if (!fileStat.isFile()) continue;
      writeDownloadManifest(row.video_id, filePath, fileStat.size);
      claimedMedia.add(filePath);
      manifestsBackfilled++;
      log.info("downloads.manifest_backfilled", { videoId: row.video_id, path: manifestPath });
    } catch (error) {
      log.warn("downloads.manifest_backfill_failed", { videoId: row.video_id, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const candidatesById = new Map<string, string[]>();
  for (const filePath of allFiles) {
    if (claimedMedia.has(filePath) || !MEDIA_EXTENSIONS.has(extname(filePath).toLowerCase())) continue;
    const relativePath = relative(root, filePath);
    const matches = rows.filter((row) => /^[A-Za-z0-9_-]{11}$/.test(row.video_id) && relativePath.includes(row.video_id));
    if (matches.length !== 1) {
      if (matches.length > 1) log.warn("downloads.filename_recovery_ambiguous", { path: filePath, videoIds: matches.map((row) => row.video_id) });
      continue;
    }
    const paths = candidatesById.get(matches[0].video_id) ?? [];
    paths.push(filePath);
    candidatesById.set(matches[0].video_id, paths);
  }

  for (const [videoId, paths] of candidatesById) {
    const row = byId.get(videoId)!;
    if (row.status === "done" && row.path && existsSync(row.path)) continue;
    if (paths.length !== 1) {
      log.warn("downloads.filename_recovery_ambiguous", { videoId, paths });
      continue;
    }
    try {
      await recoverRow(row, paths[0], "filename", onRecovered);
      recovered++;
      recoveredVideoIds.add(videoId);
    } catch (error) {
      log.warn("downloads.filename_recovery_failed", { videoId, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return { recovered, recoveredVideoIds, manifestsBackfilled };
}
