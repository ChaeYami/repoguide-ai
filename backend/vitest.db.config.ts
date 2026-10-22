import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// 실제 Postgres(Supabase 테스트 프로젝트 또는 로컬)에 대해 실행한다. TEST_DATABASE_URL 필요.
export default defineConfig({
  resolve: {
    alias: {
      "@repoguide/shared": fileURLToPath(new URL("../shared/src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["tests/db/**/*.test.ts"],
    fileParallelism: false,
  },
});
