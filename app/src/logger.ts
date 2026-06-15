import { appendFileSync, closeSync, mkdirSync, openSync, readSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

const LOG_PATH = process.env.LOG_PATH ?? resolve(import.meta.dir, "../../data/logs/ytzero.log");
const MAX_READ_BYTES = 512 * 1024;

type LogLevel = "info" | "warn" | "error";

function serializeMeta(meta?: Record<string, unknown>) {
  if (!meta) return "";
  try {
    return ` ${JSON.stringify(meta)}`;
  } catch {
    return " [unserializable-meta]";
  }
}

function write(level: LogLevel, event: string, meta?: Record<string, unknown>) {
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${event}${serializeMeta(meta)}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
  try {
    mkdirSync(dirname(LOG_PATH), { recursive: true });
    appendFileSync(LOG_PATH, `${line}\n`);
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
