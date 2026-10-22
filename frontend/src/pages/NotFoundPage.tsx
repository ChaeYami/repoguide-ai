import { Link } from "react-router";

export function NotFoundPage() {
  return (
    <>
      <h1 className="text-2xl font-bold">페이지를 찾을 수 없습니다</h1>
      <Link to="/" className="mt-4 inline-block text-blue-700 underline">
        처음으로 돌아가기
      </Link>
    </>
  );
}
