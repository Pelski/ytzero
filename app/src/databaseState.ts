import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { databaseConfig } from "./database";
import { databaseLocatorFingerprint } from "./databaseConfig";

interface PendingMigration {
  targetEngine: "postgres";
  targetFingerprint: string;
  receiptId: string;
  completedAt: string;
}

interface DatabaseStateFile {
  version: 1;
  activeEngine: "sqlite" | "postgres";
  activeFingerprint: string;
  pendingMigration?: PendingMigration;
}

function readState(): DatabaseStateFile | null {
  try {
    if (!existsSync(databaseConfig.statePath)) return null;
    const value = JSON.parse(readFileSync(databaseConfig.statePath, "utf8"));
    return value?.version === 1 ? value as DatabaseStateFile : null;
  } catch {
    return null;
  }
}

function writeState(state: DatabaseStateFile): void {
  mkdirSync(dirname(databaseConfig.statePath), { recursive: true });
  const temporary = `${databaseConfig.statePath}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, databaseConfig.statePath);
}

let state = readState();
if (!state) {
  state = { version: 1, activeEngine: databaseConfig.engine, activeFingerprint: databaseConfig.locatorFingerprint };
  writeState(state);
}

export function databaseRuntimeStatus() {
  const currentMatches = state!.activeEngine === databaseConfig.engine && state!.activeFingerprint === databaseConfig.locatorFingerprint;
  const pendingMatches = state!.pendingMigration?.targetEngine === databaseConfig.engine
    && state!.pendingMigration.targetFingerprint === databaseConfig.locatorFingerprint;
  return {
    engine: databaseConfig.engine,
    location: databaseConfig.displayLocation,
    state: currentMatches ? "current" : pendingMatches ? "migration_ready" : "unexpected_change",
    previousEngine: state!.activeEngine,
    pendingReceiptId: pendingMatches ? state!.pendingMigration?.receiptId ?? null : null,
  } as const;
}

export function recordCompletedPostgresMigration(targetUrl: string, receiptId: string): void {
  state = {
    ...state!,
    pendingMigration: {
      targetEngine: "postgres",
      targetFingerprint: databaseLocatorFingerprint("postgres", targetUrl),
      receiptId,
      completedAt: new Date().toISOString(),
    },
  };
  writeState(state);
}

export function acceptCurrentDatabase(): void {
  state = {
    version: 1,
    activeEngine: databaseConfig.engine,
    activeFingerprint: databaseConfig.locatorFingerprint,
  };
  writeState(state);
}
