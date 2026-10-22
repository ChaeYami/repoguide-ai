import ReactMarkdown, { type Components } from "react-markdown";

// LLM이 쓴 마크다운을 안전하게 렌더링한다 (research R9). 원시 HTML은 렌더링하지 않고, 링크는 http(s)만 허용한다.

export function safeUrl(url: string): string {
  return /^https?:\/\//i.test(url.trim()) ? url : "";
}

const components: Components = {
  a: ({ href, children }) =>
    href ? (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  pre: ({ children }) => <pre className="overflow-x-auto rounded bg-slate-900 p-3 text-sm text-slate-100">{children}</pre>,
  code: ({ children, className }) => <code className={`${className ?? ""} break-words`}>{children}</code>,
  ul: ({ children }) => <ul className="list-disc pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5">{children}</ol>,
};

export function SafeMarkdown({ children }: { children: string }) {
  return (
    <div className="space-y-2 break-words leading-relaxed">
      <ReactMarkdown skipHtml urlTransform={safeUrl} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
