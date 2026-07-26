import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { rotateDailyLog } from "./logger";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempLogPath() {
  const dir = mkdtempSync(join(tmpdir(), "ytzero-logger-"));
  dirs.push(dir);
  return join(dir, "ytzero.log");
}

describe("daily log rotation", () => {
  test("keeps the active file during the same configured day", () => {
    const path = tempLogPath();
    writeFileSync(path, "today\n");

    expect(rotateDailyLog(path, "2026-07-26", "2026-07-26")).toBe("2026-07-26");
    expect(existsSync(path)).toBe(true);
  });

  test("archives the active file on the first write of a new configured day", () => {
    const path = tempLogPath();
    writeFileSync(path, "yesterday\n");

    expect(rotateDailyLog(path, "2026-07-27", "2026-07-26")).toBe("2026-07-27");
    expect(existsSync(path)).toBe(false);
    expect(existsSync(join(dirname(path), "ytzero-2026-07-26.log"))).toBe(true);
  });

  test("does not overwrite an existing archive", () => {
    const path = tempLogPath();
    writeFileSync(path, "second process\n");
    writeFileSync(join(dirname(path), "ytzero-2026-07-26.log"), "first process\n");

    rotateDailyLog(path, "2026-07-27", "2026-07-26");

    expect(existsSync(join(dirname(path), "ytzero-2026-07-26.1.log"))).toBe(true);
  });

  test("uses the configured timezone when recovering the active day after restart", () => {
    const path = tempLogPath();
    writeFileSync(path, "after local midnight\n");
    const modified = new Date("2026-07-26T22:30:00.000Z"); // July 27 in Warsaw
    utimesSync(path, modified, modified);

    rotateDailyLog(path, "2026-07-27", null, "Europe/Warsaw");

    expect(existsSync(path)).toBe(true);
  });
});
