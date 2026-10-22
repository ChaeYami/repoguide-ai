import { fileURLToPath } from "node:url";
import type { SQL } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { schema } from "./schema.js";

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DbHandle {
  db: Database;
  ping(): Promise<void>;
  close(): Promise<void>;
}

/** 원시 SQL 결과를 행 배열로 맞춘다. postgres.js는 배열, PGlite는 { rows }를 돌려준다. */
export async function queryRows<T>(db: Database, query: SQL): Promise<T[]> {
  const result: unknown = await db.execute(query);
  return (Array.isArray(result) ? result : (result as { rows: T[] }).rows) as T[];
}

/** src/db와 dist/db 모두에서 backend/drizzle을 가리킨다. */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../drizzle", import.meta.url));

function requiresTls(url: string): boolean {
  const host = new URL(url).hostname;
  return host.endsWith(".supabase.com") || host.endsWith(".supabase.co");
}

/** Supabase(Direct 또는 Session pooler 5432) 또는 일반 Postgres에 연결한다. */
export function createPostgresDb(
  url: string,
  options: { max?: number } = {},
): DbHandle & { migrate(): Promise<void> } {
  const client = postgres(url, {
    max: options.max ?? 10,
    connect_timeout: 10,
    onnotice: () => {},
    ...(requiresTls(url) ? { ssl: "require" as const } : {}),
  });
  const db = drizzle(client, { schema });
  return {
    db,
    async ping() {
      await client`select 1`;
    },
    async close() {
      await client.end({ timeout: 5 });
    },
    async migrate() {
      await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    },
  };
}
