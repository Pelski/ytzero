import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readSync, renameSync, statSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { configuredTimeZone, formatZonedTimestamp, zonedDayHour } from "./timeZone";

const LOG_PATH = process.env.LOG_PATH ?? resolve(import.meta.dir, "../../data/logs/ytzero.log");
const MAX_READ_BYTES = 512 * 1024;

type LogLevel = "info" | "warn" | "error";
export type LogStreamEvent = { line: string; size: number };

let activeLogDay: string | null = null;
const logSubscribers = new Set<(event: LogStreamEvent) => void>();

export function subscribeToLogs(listener: (event: LogStreamEvent) => void) {
  logSubscribers.add(listener);
  return () => logSubscribers.delete(listener);
}

function publishLog(event: LogStreamEvent) {
  for (const listener of logSubscribers) {
    try {
      listener(event);
    } catch {
      // A broken live viewer must never interrupt application logging.
    }
  }
}

function archivePath(path: string, day: string) {
  const dir = dirname(path);
  const ext = extname(path);
  const stem = basename(path, ext);
  const base = join(dir, `${stem}-${day}`);
  let candidate = `${base}${ext}`;
  let suffix = 1;
  while (existsSync(candidate)) candidate = `${base}.${suffix++}${ext}`;
  return candidate;
}

/** Rotate before the first write of a new configured local day. */
export function rotateDailyLog(path: string, currentDay: string, knownDay: string | null = null, timeZone = "UTC") {
  if (!existsSync(path)) return currentDay;
  const fileDay = knownDay ?? zonedDayHour(statSync(path).mtime, timeZone).day;
  if (fileDay === currentDay) return currentDay;
  renameSync(path, archivePath(path, fileDay));
  return currentDay;
}

function serializeMeta(meta?: Record<string, unknown>) {
  if (!meta) return "";
  try {
    return ` ${JSON.stringify(meta)}`;
  } catch {
    return " [unserializable-meta]";
  }
}

function write(level: LogLevel, event: string, meta?: Record<string, unknown>) {
  const now = new Date();
  const timeZone = configuredTimeZone();
  const line = `${formatZonedTimestamp(now, timeZone)} ${level.toUpperCase()} ${event}${serializeMeta(meta)}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
  try {
    mkdirSync(dirname(LOG_PATH), { recursive: true });
    activeLogDay = rotateDailyLog(LOG_PATH, zonedDayHour(now, timeZone).day, activeLogDay, timeZone);
    appendFileSync(LOG_PATH, `${line}\n`);
    publishLog({ line, size: statSync(LOG_PATH).size });
  } catch (e) {
    console.error(`[ytzero] failed to write log file: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export const log = {
  info: (event: string, meta?: Record<string, unknown>) => write("info", event, meta),
  warn: (event: string, meta?: Record<string, unknown>) => write("warn", event, meta),
  error: (event: string, meta?: Record<string, unknown>) => write("error", event, meta),
};

export function readRecentLogs(limit = 300) {
  let fd: number | null = null;
  try {
    const size = statSync(LOG_PATH).size;
    const bytesToRead = Math.min(size, MAX_READ_BYTES);
    const buffer = Buffer.alloc(bytesToRead);
    fd = openSync(LOG_PATH, "r");
    readSync(fd, buffer, 0, bytesToRead, Math.max(0, size - bytesToRead));
    const content = buffer.toString("utf8");
    const lines = content
      .trimEnd()
      .split("\n");
    return { size, lines: lines.slice(-limit) };
  } catch {
    return { size: 0, lines: [] };
  } finally {
    if (fd != null) closeSync(fd);
  }
}
