import { defineConfig } from "drizzle-kit";

// 마이그레이션 생성 전용 설정 (오프라인). 적용은 `npm run db:migrate`가 담당한다.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
