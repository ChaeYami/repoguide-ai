import { RepoForm } from "../components/RepoForm";

// 최근 분석 목록은 T039에서 추가한다.
export function HomePage() {
  return (
    <>
      <h1 className="text-2xl font-bold">저장소 매뉴얼 만들기</h1>
      <p className="mt-2 text-slate-600">
        GitHub 저장소 주소를 넣으면 실제 코드와 문서를 분석해 내 수준과 목적에 맞는 매뉴얼을 만들어 드려요.
      </p>
      <RepoForm />
    </>
  );
}
