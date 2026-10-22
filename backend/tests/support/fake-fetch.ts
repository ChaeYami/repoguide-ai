// GitHub 응답을 흉내 내는 fetch. 경로 패턴별로 응답(또는 응답 순서)을 지정한다.

export type FakeResponse = { status?: number; body?: unknown; headers?: Record<string, string> } | "network_error";

export interface FakeRoute {
  match: RegExp;
  responses: FakeResponse[];
}

export interface FakeFetch {
  fetch: typeof fetch;
  calls: { url: string; headers: Record<string, string> }[];
  maxInFlight: number;
}

function toResponse(spec: Exclude<FakeResponse, "network_error">): Response {
  const status = spec.status ?? 200;
  const body =
    spec.body === undefined
      ? null
      : spec.body instanceof Uint8Array || typeof spec.body === "string"
        ? spec.body
        : JSON.stringify(spec.body);
  return new Response(body as ConstructorParameters<typeof Response>[0], { status, headers: spec.headers });
}

export function createFakeFetch(routes: FakeRoute[], options: { delayMs?: number } = {}): FakeFetch {
  const state: FakeFetch = { fetch: undefined as never, calls: [], maxInFlight: 0 };
  let inFlight = 0;
  const cursors = new Map<FakeRoute, number>();

  state.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    state.calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    inFlight += 1;
    state.maxInFlight = Math.max(state.maxInFlight, inFlight);
    try {
      if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      const route = routes.find((candidate) => candidate.match.test(url));
      if (!route) return toResponse({ status: 404, body: { message: "Not Found" } });
      const index = cursors.get(route) ?? 0;
      cursors.set(route, index + 1);
      const spec = route.responses[Math.min(index, route.responses.length - 1)]!;
      if (spec === "network_error") throw new TypeError("fetch failed");
      return toResponse(spec);
    } finally {
      inFlight -= 1;
    }
  }) as typeof fetch;

  return state;
}

export const repoBody = (overrides: Record<string, unknown> = {}) => ({
  name: "app",
  owner: { login: "acme" },
  private: false,
  default_branch: "main",
  description: "Demo app",
  language: "TypeScript",
  html_url: "https://github.com/acme/app",
  ...overrides,
});
