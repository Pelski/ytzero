import { AsyncDatabaseClient } from "./databaseClient";
import { databaseRuntimeConfig } from "./databaseConfig";
import { sqliteBusyTimeoutMs } from "./sqliteMaintenance";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const databaseConfig = databaseRuntimeConfig();
if (databaseConfig.engine === "sqlite") mkdirSync(dirname(databaseConfig.sqlitePath), { recursive: true });
export const database = new AsyncDatabaseClient(databaseConfig.engine, databaseConfig.url);

if (databaseConfig.engine === "sqlite") {
  await database.exec("PRAGMA journal_mode = WAL");
  await database.exec("PRAGMA foreign_keys = ON");
  await database.exec(`PRAGMA busy_timeout = ${sqliteBusyTimeoutMs()}`);
}
