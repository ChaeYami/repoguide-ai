import { loadConfig } from "../../src/config/env.js";

/** npm run test:db 전용. 운영 DB를 실수로 쓰지 않도록 DATABASE_URL과 같은 값이면 거부한다. */
export function requireTestDatabaseUrl(): string {
  const { env } = loadConfig({ require: ["TEST_DATABASE_URL"] });
  const url = env.TEST_DATABASE_URL!;
  if (env.DATABASE_URL !== undefined && env.DATABASE_URL === url) {
    throw new Error("TEST_DATABASE_URL이 DATABASE_URL과 같습니다. 테스트는 테이블을 비우므로 별도 DB를 지정해 주세요.");
  }
  return url;
}
