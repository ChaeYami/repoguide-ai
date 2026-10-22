import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildServer, REDACT_PATHS } from "../../src/api/server.js";

// 보안 점검 (T050, Constitution 보안 제약, FR-029, research R9·R12).

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SECRET_PATTERNS = [/AIza[0-9A-Za-z_-]{20,}/, /github_pat_[0-9A-Za-z_]{20,}/, /gh[pousr]_[0-9A-Za-z]{30,}/, /postgres(ql)?:\/\/[^\s:@/]+:[^\s@[\]]{4,}@/];

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

describe("logging", () => {
  it("never writes the Authorization header or cookies to the log", async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, done) {
        lines.push(String(chunk));
        done();
      },
    });
    const app = await buildServer({
      db: { ping: async () => {} },
      logger: { level: "info", stream, redact: { paths: REDACT_PATHS, censor: "[redacted]" }, serializers: { req: (req) => ({ method: req.method, url: req.url, headers: req.headers }) } },
    });
    await app.inject({ method: "GET", url: "/api/health", headers: { authorization: "Bearer github_pat_SHOULD_NOT_LEAK_0123456789", cookie: "session=SECRET_COOKIE" } });
    const log = lines.join("");
    expect(log).toContain("/api/health");
    expect(log).toContain("[redacted]");
    expect(log).not.toContain("SHOULD_NOT_LEAK");
    expect(log).not.toContain("SECRET_COOKIE");
  });
});

describe("frontend bundle", () => {
  const frontendFiles = [
    ...filesUnder(join(ROOT, "frontend/src")),
    ...filesUnder(join(ROOT, "frontend/dist")),
    join(ROOT, "frontend/index.html"),
    join(ROOT, "frontend/vite.config.ts"),
  ];

  it("contains no secret-looking values", () => {
    expect(frontendFiles.length).toBeGreaterThan(5);
    for (const file of frontendFiles) {
      const text = readFileSync(file, "utf8");
      for (const pattern of SECRET_PATTERNS) expect(pattern.test(text), `${file} ${pattern}`).toBe(false);
    }
  });

  it("reads no custom environment variables in the browser (secrets stay on the server)", () => {
    for (const file of filesUnder(join(ROOT, "frontend/src"))) {
      const text = readFileSync(file, "utf8");
      const used = [...text.matchAll(/import\.meta\.env\.([A-Z_]+)/g)].map((match) => match[1]);
      expect(used.filter((name) => !["MODE", "DEV", "PROD", "BASE_URL", "SSR"].includes(name!)), file).toEqual([]);
    }
  });
});

describe(".env.example", () => {
  it("ships the secret keys empty", () => {
    const text = readFileSync(join(ROOT, ".env.example"), "utf8");
    for (const key of ["GEMINI_API_KEY", "GITHUB_TOKEN", "DATABASE_URL", "CLIENT_KEY_SALT", "TEST_DATABASE_URL"]) {
      expect(text).toMatch(new RegExp(`^${key}=$`, "m"));
    }
  });
});
