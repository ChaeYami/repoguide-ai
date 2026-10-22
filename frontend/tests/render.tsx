import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";

/** 라우터·쿼리 클라이언트를 갖춘 렌더 도우미 */
export function renderWithProviders(ui: ReactNode, options: { path?: string; route?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[options.route ?? "/"]}>
        <Routes>
          <Route path={options.path ?? "/"} element={ui} />
          <Route path="/a/:id" element={<p>분석 페이지로 이동함</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
