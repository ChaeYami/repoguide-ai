import type { DetectedStack } from "@repoguide/shared";
import { basename } from "./tree-filter.js";
import { MANIFEST_NAMES } from "./seeds.js";

// 매니페스트·잠금 파일의 존재, 확장자 분포, 시드 파일 내용으로 기술 스택을 추정한다 (research R7).

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: "TypeScript", tsx: "TypeScript", mts: "TypeScript", cts: "TypeScript",
  js: "JavaScript", jsx: "JavaScript", mjs: "JavaScript", cjs: "JavaScript",
  py: "Python", go: "Go", rs: "Rust", java: "Java", kt: "Kotlin", kts: "Kotlin",
  rb: "Ruby", php: "PHP", cs: "C#", fs: "F#", swift: "Swift", dart: "Dart", scala: "Scala",
  c: "C", h: "C/C++", cpp: "C++", cc: "C++", cxx: "C++", hpp: "C++",
  vue: "Vue", svelte: "Svelte", sh: "Shell", ps1: "PowerShell", lua: "Lua", r: "R",
  ex: "Elixir", exs: "Elixir", clj: "Clojure", hs: "Haskell", sql: "SQL",
};

const MANAGER_BY_LOCKFILE: Record<string, string> = {
  "package-lock.json": "npm",
  "yarn.lock": "yarn",
  "pnpm-lock.yaml": "pnpm",
  "bun.lockb": "bun",
  "bun.lock": "bun",
  "poetry.lock": "poetry",
  "pipfile.lock": "pipenv",
  "uv.lock": "uv",
  "cargo.lock": "cargo",
  "go.sum": "go modules",
  "composer.lock": "composer",
  "gemfile.lock": "bundler",
};

const MANAGER_BY_MANIFEST: Record<string, string> = {
  "package.json": "npm",
  "requirements.txt": "pip",
  "pyproject.toml": "pip",
  "setup.py": "pip",
  "go.mod": "go modules",
  "cargo.toml": "cargo",
  "pom.xml": "maven",
  "build.gradle": "gradle",
  "build.gradle.kts": "gradle",
  gemfile: "bundler",
  "composer.json": "composer",
};

const JS_FRAMEWORKS: [string, string][] = [
  ["next", "Next.js"], ["react", "React"], ["vue", "Vue"], ["nuxt", "Nuxt"], ["svelte", "Svelte"],
  ["@sveltejs/kit", "SvelteKit"], ["@angular/core", "Angular"], ["astro", "Astro"], ["gatsby", "Gatsby"],
  ["@remix-run/react", "Remix"], ["react-native", "React Native"], ["expo", "Expo"], ["electron", "Electron"],
  ["express", "Express"], ["fastify", "Fastify"], ["@nestjs/core", "NestJS"], ["koa", "Koa"], ["hono", "Hono"],
  ["vite", "Vite"], ["tailwindcss", "Tailwind CSS"], ["prisma", "Prisma"], ["drizzle-orm", "Drizzle ORM"],
  ["typeorm", "TypeORM"], ["mongoose", "Mongoose"], ["jest", "Jest"], ["vitest", "Vitest"],
];

const TEXT_FRAMEWORKS: { files: string[]; pattern: RegExp; hint: string }[] = [
  { files: ["requirements.txt", "pyproject.toml", "setup.py"], pattern: /\bdjango\b/i, hint: "Django" },
  { files: ["requirements.txt", "pyproject.toml", "setup.py"], pattern: /\bflask\b/i, hint: "Flask" },
  { files: ["requirements.txt", "pyproject.toml", "setup.py"], pattern: /\bfastapi\b/i, hint: "FastAPI" },
  { files: ["requirements.txt", "pyproject.toml", "setup.py"], pattern: /\bstreamlit\b/i, hint: "Streamlit" },
  { files: ["requirements.txt", "pyproject.toml", "setup.py"], pattern: /\btorch\b/i, hint: "PyTorch" },
  { files: ["go.mod"], pattern: /gin-gonic\/gin/, hint: "Gin" },
  { files: ["go.mod"], pattern: /labstack\/echo/, hint: "Echo" },
  { files: ["go.mod"], pattern: /gofiber\/fiber/, hint: "Fiber" },
  { files: ["cargo.toml"], pattern: /\bactix-web\b/, hint: "Actix Web" },
  { files: ["cargo.toml"], pattern: /\baxum\b/, hint: "Axum" },
  { files: ["cargo.toml"], pattern: /\btokio\b/, hint: "Tokio" },
  { files: ["gemfile"], pattern: /['"]rails['"]/, hint: "Rails" },
  { files: ["composer.json"], pattern: /laravel\/framework/, hint: "Laravel" },
  { files: ["composer.json"], pattern: /symfony\//, hint: "Symfony" },
];

const MAX_LANGUAGES = 5;
const MAX_MANIFESTS = 20;

export interface StackInput {
  /** 필터를 통과한 후보 경로 */
  paths: readonly string[];
  lockfiles: readonly string[];
  /** 시드로 읽은 매니페스트 내용 (경로 → 내용) */
  manifestContents: Readonly<Record<string, string>>;
}

function pushUnique(list: string[], value: string) {
  if (!list.includes(value)) list.push(value);
}

function topLanguages(paths: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const path of paths) {
    const name = basename(path);
    const dot = name.lastIndexOf(".");
    const language = dot > 0 ? LANGUAGE_BY_EXTENSION[name.slice(dot + 1).toLowerCase()] : undefined;
    if (language) counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_LANGUAGES)
    .map(([language]) => language);
}

function packageJsonFrameworks(content: string): string[] {
  let parsed: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    parsed = JSON.parse(content) as typeof parsed;
  } catch {
    return [];
  }
  const names = new Set([...Object.keys(parsed.dependencies ?? {}), ...Object.keys(parsed.devDependencies ?? {})]);
  return JS_FRAMEWORKS.filter(([dependency]) => names.has(dependency)).map(([, hint]) => hint);
}

export function detectStack(input: StackInput): DetectedStack {
  const packageManagers: string[] = [];
  const frameworkHints: string[] = [];

  for (const lockfile of input.lockfiles) {
    const manager = MANAGER_BY_LOCKFILE[basename(lockfile).toLowerCase()];
    if (manager) pushUnique(packageManagers, manager);
  }

  const manifests = input.paths
    .filter((path) => {
      const name = basename(path).toLowerCase();
      return MANIFEST_NAMES.includes(name) || name.endsWith(".csproj");
    })
    .sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b))
    .slice(0, MAX_MANIFESTS);

  for (const manifest of manifests) {
    const name = basename(manifest).toLowerCase();
    const manager = name.endsWith(".csproj") ? "nuget" : MANAGER_BY_MANIFEST[name];
    if (manager && !(manager === "npm" && packageManagers.some((m) => ["yarn", "pnpm", "bun"].includes(m)))) {
      pushUnique(packageManagers, manager);
    }
  }

  for (const [path, content] of Object.entries(input.manifestContents)) {
    const name = basename(path).toLowerCase();
    if (name === "package.json") packageJsonFrameworks(content).forEach((hint) => pushUnique(frameworkHints, hint));
    for (const rule of TEXT_FRAMEWORKS) {
      if (rule.files.includes(name) && rule.pattern.test(content)) pushUnique(frameworkHints, rule.hint);
    }
  }

  return { languages: topLanguages(input.paths), packageManagers, frameworkHints, manifests };
}
