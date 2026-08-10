import type { AsyncDatabaseClient } from "./databaseClient";
import type { DatabaseEngine } from "./databaseConfig";

export const CANONICAL_SCHEMA_FILES = [
  "app/src/schema.sql",
  "app/src/channelPostsSchema.sql",
] as const;

interface AddColumnStep {
  kind: "add-column";
  table: string;
  column: string;
  definition: string;
}

interface SqlStep {
  kind: "sql";
  statement: string;
}

interface NoopStep {
  kind: "noop";
  reason: string;
}

export type DatabaseMigrationStep = AddColumnStep | SqlStep | NoopStep;

export interface DatabaseMigration {
  version: number;
  name: string;
  schemaHashes: Record<(typeof CANONICAL_SCHEMA_FILES)[number], string>;
  sqlite: readonly DatabaseMigrationStep[];
  postgres: readonly DatabaseMigrationStep[];
}

// Version 1 belongs to the older SQLite-only migration runner. Every migration
// from version 2 onward must explicitly support both database engines. The
// repository check enforces the two implementations and schema fingerprints.
export const DATABASE_MIGRATIONS: readonly DatabaseMigration[] = [
  {
    version: 2,
    name: "postgres-compatibility-columns",
    schemaHashes: {
      "app/src/schema.sql": "76d5ac28c9619f64bf85c9928c1c4e43a8f34069aae9c789e5f12eba8d8c08dd",
      "app/src/channelPostsSchema.sql": "70a7df33bf373524cf6cd0687e46d7987a7cd90a2619fd9586d12d6f940d45a5",
    },
    sqlite: [
      { kind: "add-column", table: "users", column: "is_admin", definition: "INTEGER NOT NULL DEFAULT 0" },
      { kind: "add-column", table: "user_channels", column: "shorts_feed_visibility", definition: "TEXT" },
    ],
    postgres: [
      { kind: "add-column", table: "users", column: "is_admin", definition: "INTEGER NOT NULL DEFAULT 0" },
      { kind: "add-column", table: "user_channels", column: "shorts_feed_visibility", definition: "TEXT" },
    ],
  },
  {
    version: 3,
    name: "resume-playback-context",
    schemaHashes: {
      "app/src/schema.sql": "a0e8fea9bc340532d0f77b0879eb07207efe2daa6ef5f67366cd6242d6367dcd",
      "app/src/channelPostsSchema.sql": "70a7df33bf373524cf6cd0687e46d7987a7cd90a2619fd9586d12d6f940d45a5",
    },
    sqlite: [
      { kind: "add-column", table: "user_videos", column: "playback_context_json", definition: "TEXT" },
    ],
    postgres: [
      { kind: "add-column", table: "user_videos", column: "playback_context_json", definition: "TEXT" },
    ],
  },
];

function quoteIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) throw new Error(`unsafe database identifier: ${identifier}`);
  return `"${identifier}"`;
}

async function columnExists(
  client: AsyncDatabaseClient,
  engine: DatabaseEngine,
  table: string,
  column: string,
): Promise<boolean> {
  if (engine === "sqlite") {
    const rows = await client.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all<{ name: string }>();
    return rows.some((row) => row.name === column);
  }
  const row = await client.prepare(`
    SELECT 1 AS present
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ? AND column_name = ?
  `).get(table, column);
  return Boolean(row);
}

async function applyStep(
  client: AsyncDatabaseClient,
  engine: DatabaseEngine,
  step: DatabaseMigrationStep,
): Promise<void> {
  if (step.kind === "noop") return;
  if (step.kind === "sql") {
    await client.exec(step.statement);
    return;
  }
  if (await columnExists(client, engine, step.table, step.column)) return;
  await client.exec(
    `ALTER TABLE ${quoteIdentifier(step.table)} ADD COLUMN ${quoteIdentifier(step.column)} ${step.definition}`,
  );
}

export async function applyDatabaseMigrations(client: AsyncDatabaseClient): Promise<number> {
  await client.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);
  const applied = new Map(
    (await client.prepare("SELECT version, name FROM schema_migrations ORDER BY version").all<{ version: number; name: string }>())
      .map((row) => [Number(row.version), row.name]),
  );
  let latest = 0;

  for (const migration of DATABASE_MIGRATIONS) {
    latest = Math.max(latest, migration.version);
    const recordedName = applied.get(migration.version);
    if (recordedName && recordedName !== migration.name) {
      throw new Error(`database migration ${migration.version} checksum mismatch: expected ${migration.name}, found ${recordedName}`);
    }
    if (recordedName) continue;
    await client.transaction(async () => {
      for (const step of migration[client.engine]) await applyStep(client, client.engine, step);
      await client.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)")
        .run(migration.version, migration.name, new Date().toISOString());
    })();
  }
  return latest;
}
