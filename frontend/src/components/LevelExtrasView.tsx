import type { LevelExtras } from "@repoguide/shared";

// 수준별 추가 요소 (FR-021): 입문자 용어·선행 지식, 바이브 코딩 맥락·관련 파일·요청 예시·체크리스트.

export function LevelExtrasView({ extras }: { extras: LevelExtras }) {
  if (extras.level === "developer") return null;

  if (extras.level === "beginner") {
    if (extras.prerequisites.length === 0 && extras.glossary.length === 0) return null;
    return (
      <aside className="mt-6 space-y-4 rounded-lg bg-sky-50 p-4">
        {extras.prerequisites.length > 0 && (
          <div>
            <h2 className="font-semibold">시작하기 전에 알아 둘 것</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
              {extras.prerequisites.map((item) => (
                <li key={item.topic}>
                  <strong>{item.topic}</strong> — {item.explanation}
                </li>
              ))}
            </ul>
          </div>
        )}
        {extras.glossary.length > 0 && (
          <div>
            <h2 className="font-semibold">용어 풀이</h2>
            <dl className="mt-2 space-y-1 text-sm">
              {extras.glossary.map((item) => (
                <div key={item.term}>
                  <dt className="inline font-medium">{item.term}</dt>
                  <dd className="inline"> — {item.explanation}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </aside>
    );
  }

  return (
    <aside className="mt-6 space-y-4 rounded-lg bg-violet-50 p-4">
      {extras.contextSummary && (
        <div>
          <h2 className="font-semibold">AI 도구에 붙여 넣을 프로젝트 맥락</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm">{extras.contextSummary}</p>
        </div>
      )}
      {extras.relatedFiles.length > 0 && (
        <div>
          <h2 className="font-semibold">관련 파일</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {extras.relatedFiles.map((file) => (
              <li key={file.path} className="break-all">
                <a href={file.url} target="_blank" rel="noopener noreferrer" className="font-mono text-blue-700 underline">
                  {file.path}
                </a>{" "}
                — {file.why}
              </li>
            ))}
          </ul>
        </div>
      )}
      {extras.promptExamples.length > 0 && (
        <div>
          <h2 className="font-semibold">AI에게 요청하는 예시</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {extras.promptExamples.map((example) => (
              <li key={example.title}>
                <p className="font-medium">{example.title}</p>
                <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded bg-white p-2">{example.prompt}</pre>
              </li>
            ))}
          </ul>
        </div>
      )}
      {extras.checklist.length > 0 && (
        <div>
          <h2 className="font-semibold">변경 후 확인할 것</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {extras.checklist.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
