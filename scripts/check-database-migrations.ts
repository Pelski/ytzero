import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CANONICAL_SCHEMA_FILES,
  DATABASE_MIGRATIONS,
} from "../app/src/databaseMigrations";

function fail(message: string): never {
  console.error(`Database migration check failed: ${message}`);
  process.exit(1);
}

let previousVersion = 1;
const names = new Set<string>();
for (const migration of DATABASE_MIGRATIONS) {
  if (!Number.isInteger(migration.version) || migration.version <= previousVersion) {
    fail(`migration versions must increase after ${previousVersion}`);
  }
  if (names.has(migration.name)) fail(`duplicate migration name: ${migration.name}`);
  if (!migration.sqlite.length) fail(`migration ${migration.version} has no SQLite implementation`);
  if (!migration.postgres.length) fail(`migration ${migration.version} has no PostgreSQL implementation`);
  names.add(migration.name);
  previousVersion = migration.version;
}

const latest = DATABASE_MIGRATIONS.at(-1);
if (!latest) fail("the cross-database migration registry is empty");
for (const file of CANONICAL_SCHEMA_FILES) {
  const actual = createHash("sha256").update(readFileSync(resolve(file))).digest("hex");
  if (latest.schemaHashes[file] !== actual) {
    fail(`${file} changed without a new migration for both SQLite and PostgreSQL (new SHA-256: ${actual})`);
  }
}

console.log(`Database migrations OK through version ${latest.version} (${latest.name}).`);
