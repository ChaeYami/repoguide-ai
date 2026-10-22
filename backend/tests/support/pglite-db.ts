import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { type DbHandle, MIGRATIONS_FOLDER } from "../../src/db/client.js";
import { schema } from "../../src/db/schema.js";

/** 프로세스 안에서 도는 Postgres(PGlite)에 실제 마이그레이션을 적용한 DB. 외부 서비스 없이 SQL을 검증한다. */
export async function createPgliteDb(): Promise<DbHandle> {
  const client = await PGlite.create({ extensions: { vector } });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return {
    db,
    async ping() {
      await client.query("select 1");
    },
    async close() {
      await client.close();
    },
  };
}
