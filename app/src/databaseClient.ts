import { SQL } from "bun";
import { AsyncLocalStorage } from "node:async_hooks";
import type { DatabaseEngine } from "./databaseConfig";

export interface RunResult {
  changes: number;
  lastInsertRowid: number | string | null;
}

export interface AsyncStatement {
  get<T = any>(...params: unknown[]): Promise<T | null>;
  all<T = any>(...params: unknown[]): Promise<T[]>;
  run(...params: unknown[]): Promise<RunResult>;
}

function replaceQuestionParameters(sql: string): string {
  let output = "";
  let parameter = 0;
  let state: "normal" | "single" | "double" | "line" | "block" = "normal";
  for (let index = 0; index < sql.length; index++) {
    const char = sql[index];
    const next = sql[index + 1];
    if (state === "normal") {
      if (char === "'") state = "single";
      else if (char === '"') state = "double";
      else if (char === "-" && next === "-") { state = "line"; output += char; continue; }
      else if (char === "/" && next === "*") { state = "block"; output += char; continue; }
      else if (char === "?") { output += `$${++parameter}`; continue; }
    } else if (state === "single" && char === "'") {
      if (next === "'") { output += char + next; index++; continue; }
      state = "normal";
    } else if (state === "double" && char === '"') {
      if (next === '"') { output += char + next; index++; continue; }
      state = "normal";
    } else if (state === "line" && char === "\n") state = "normal";
    else if (state === "block" && char === "*" && next === "/") { state = "normal"; output += char + next; index++; continue; }
    output += char;
  }
  return output;
}

const POSTGRES_UTC_NOW = "to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')";

export function postgresQuery(sql: string): string {
  let translated = replaceQuestionParameters(sql)
    .replace(/\s+COLLATE\s+NOCASE\b/gi, "")
    .replace(/\bCAST\(([^)]+)\s+AS\s+REAL\)/gi, "CAST($1 AS DOUBLE PRECISION)")
    .replace(/\bdatetime\('now'\)/gi, POSTGRES_UTC_NOW)
    .replace(/\bdatetime\('now',\s*(\$\d+)\)/gi, `to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + $1::interval, 'YYYY-MM-DD HH24:MI:SS')`)
    .replace(/\bdatetime\('now',\s*'([+-]?\d+\s+(?:hour|hours|day|days|month|months))'\)/gi, (_match, interval) => {
      const normalized = String(interval).replace(/^\+/, "");
      return `to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + INTERVAL '${normalized}', 'YYYY-MM-DD HH24:MI:SS')`;
    })
    .replace(/\bdate\('now'\)/gi, "CURRENT_DATE::text")
    .replace(/\bIS\s+(\$\d+)/gi, "IS NOT DISTINCT FROM $1")
    .replace(/\bmax\(([^,()]+),\s*([^()]+)\)/gi, "GREATEST($1, $2)");

  if (/\bINSERT\s+OR\s+IGNORE\s+INTO\b/i.test(translated)) {
    translated = translated.replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/i, "INSERT INTO").replace(/;\s*$/, "");
    translated += " ON CONFLICT DO NOTHING";
  }
  return translated;
}

const KNOWN_INTEGER_COLUMNS = new Set([
  "id", "user_id", "tag_id", "local_id", "sort_order", "hour", "rank", "attempts", "priority",
  "is_owner", "is_child", "is_short", "is_private", "is_unavailable", "published_at_approximate", "members_only",
  "enabled", "followed", "include_in_feed", "filter_only", "watched", "liked", "external", "pinned",
  "hide_members_only_from_feed", "hide_members_only_on_channel", "auto_download_min_duration_override",
  "feed_refresh_failures", "count", "n",
  "profile_id", "post_author_user_id", "like_count", "comments_count",
]);

function normalizeIntegerColumns<T>(rows: T, columns: readonly any[] | undefined): T {
  if (!Array.isArray(rows)) return rows;
  const integerNames = new Set(columns?.filter((column) => [20, 21, 23].includes(Number(column.type ?? column.dataType ?? column.dataTypeID))).map((column) => column.name) ?? []);
  for (const row of rows as Record<string, unknown>[]) {
    for (const name of Object.keys(row)) {
      if (!integerNames.has(name) && !KNOWN_INTEGER_COLUMNS.has(name)) continue;
      const value = row[name];
      if (typeof value === "string" && /^-?\d+$/.test(value)) {
        const number = Number(value);
        if (Number.isSafeInteger(number)) row[name] = number;
      } else if (typeof value === "bigint" && value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)) {
        row[name] = Number(value);
      }
    }
  }
  return rows;
}

export class AsyncDatabaseClient {
  readonly engine: DatabaseEngine;
  readonly #root: SQL;
  readonly #transaction = new AsyncLocalStorage<SQL>();

  constructor(engine: DatabaseEngine, url: string) {
    this.engine = engine;
    this.#root = engine === "sqlite"
      ? new SQL(url, { adapter: "sqlite", create: true, strict: true })
      : new SQL(url, { max: 10, bigint: false });
  }

  #sql(): SQL {
    return this.#transaction.getStore() ?? this.#root;
  }

  #query(source: string, params: unknown[] = []) {
    const sql = this.engine === "postgres" ? postgresQuery(source) : source;
    return this.#sql().unsafe(sql, params);
  }

  prepare(source: string): AsyncStatement {
    return {
      get: async <T>(...params: unknown[]) => {
        const result = this.#query(source, params);
        const raw = await result;
        const rows = normalizeIntegerColumns(raw, (raw as any).columns) as T[];
        return rows[0] ?? null;
      },
      all: async <T>(...params: unknown[]) => {
        const result = this.#query(source, params);
        const raw = await result;
        return normalizeIntegerColumns(raw, (raw as any).columns) as T[];
      },
      run: async (...params: unknown[]) => {
        const result = this.#query(source, params);
        const rows = await result;
        return {
          changes: Number((rows as any).count ?? (rows as any).affectedRows ?? 0),
          lastInsertRowid: (rows as any).lastInsertRowid ?? (rows[0] as any)?.id ?? null,
        };
      },
    };
  }

  query(source: string): AsyncStatement {
    return this.prepare(source);
  }

  async exec(source: string): Promise<void> {
    const sql = this.engine === "postgres" ? postgresQuery(source) : source;
    await this.#sql().unsafe(sql).simple();
  }

  transaction<Args extends unknown[], Result>(callback: (...args: Args) => Result | Promise<Result>): (...args: Args) => Promise<Result> {
    return async (...args: Args) => {
      if (this.#transaction.getStore()) return await callback(...args);
      return this.#root.begin((tx) => this.#transaction.run(tx, () => callback(...args))) as Promise<Result>;
    };
  }

  async close(): Promise<void> {
    await this.#root.close();
  }
}
