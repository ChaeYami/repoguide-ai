// npm run db:migrate — DATABASE_URL의 DB에 마이그레이션을 적용하고 pgvector·RLS 상태를 확인한다.
// 접속 문자열은 출력하지 않는다.
import { sql } from "drizzle-orm";
import { EnvError, loadConfig } from "../src/config/env.js";
import { createPostgresDb, queryRows } from "../src/db/client.js";

const TABLES = ["repo_snapshots", "snapshot_files", "analyses", "exploration_rounds", "explored_files", "manuals"];

async function main() {
  const { env } = loadConfig({ require: ["DATABASE_URL"] });
  const handle = createPostgresDb(env.DATABASE_URL!, { max: 1 });
  try {
    console.log("마이그레이션 적용 중...");
    await handle.migrate();

    const vector = await queryRows<{ extversion: string }>(
      handle.db,
      sql`select extversion from pg_extension where extname = 'vector'`,
    );
    const rls = await queryRows<{ relname: string; relrowsecurity: boolean }>(
      handle.db,
      sql`select relname, relrowsecurity from pg_class
          where relkind = 'r' and relnamespace = 'public'::regnamespace`,
    );

    const vectorVersion = vector[0]?.extversion;
    const tables = rls.filter((row) => TABLES.includes(row.relname));
    const withoutRls = tables.filter((row) => !row.relrowsecurity).map((row) => row.relname);

    console.log(`✔ 마이그레이션 완료 — 테이블 ${tables.length}/${TABLES.length}개`);
    console.log(vectorVersion ? `✔ pgvector ${vectorVersion} 활성화` : "✘ pgvector 확장을 찾을 수 없습니다");
    console.log(
      withoutRls.length === 0
        ? "✔ 모든 테이블에 RLS 활성화 (정책 없음 → Data API로 접근 불가)"
        : `✘ RLS가 꺼진 테이블: ${withoutRls.join(", ")}`,
    );
    if (!vectorVersion || withoutRls.length > 0 || tables.length !== TABLES.length) process.exitCode = 1;
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  if (error instanceof EnvError) {
    console.error(error.message);
  } else {
    console.error("마이그레이션 실패:", error instanceof Error ? error.message : error);
  }
  process.exitCode = 1;
});
