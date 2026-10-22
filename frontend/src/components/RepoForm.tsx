import { type Level, parseRepoUrl, type Purpose } from "@repoguide/shared";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router";
import { ApiRequestError } from "../api/client";
import { useCreateAnalysis } from "../api/queries";
import { LevelPicker } from "./LevelPicker";
import { PurposePicker } from "./PurposePicker";

// 저장소 URL·수준·목적 입력 (FR-001~FR-005). URL 형식은 백엔드와 같은 shared 파서로 즉시 검증한다.

export function RepoForm() {
  const navigate = useNavigate();
  const create = useCreateAnalysis();
  const [repoUrl, setRepoUrl] = useState("");
  const [touched, setTouched] = useState(false);
  const [level, setLevel] = useState<Level | null>(null);
  const [purpose, setPurpose] = useState<Purpose | null>(null);

  const parsed = parseRepoUrl(repoUrl);
  const urlError = touched && !parsed.ok ? parsed.error : null;
  const ready = parsed.ok && level !== null && purpose !== null && !create.isPending;
  const serverError = create.error instanceof ApiRequestError ? create.error.body : create.error ? { message: "요청에 실패했습니다.", action: undefined } : null;

  function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (!ready || !level || !purpose) return;
    create.mutate({ repoUrl: repoUrl.trim(), level, purpose }, { onSuccess: ({ id }) => navigate(`/a/${id}`) });
  }

  return (
    <form onSubmit={submit} noValidate className="mt-6">
      <label htmlFor="repo-url" className="text-sm font-semibold text-slate-700">
        GitHub 저장소 URL
      </label>
      <input
        id="repo-url"
        type="url"
        inputMode="url"
        autoComplete="off"
        placeholder="https://github.com/owner/repo"
        value={repoUrl}
        onChange={(event) => setRepoUrl(event.target.value)}
        onBlur={() => setTouched(true)}
        aria-invalid={urlError ? true : undefined}
        aria-describedby={urlError ? "repo-url-error" : undefined}
        className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-blue-600 focus:outline-none"
      />
      {urlError && (
        <p id="repo-url-error" role="alert" className="mt-1 text-sm text-red-700">
          {urlError.message} 예: {urlError.example}
        </p>
      )}

      <LevelPicker value={level} onChange={setLevel} />
      <PurposePicker value={purpose} onChange={setPurpose} />

      {serverError && (
        <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <p>{serverError.message}</p>
          {serverError.action && <p className="mt-1">{serverError.action}</p>}
        </div>
      )}

      <button
        type="submit"
        disabled={!ready}
        className="mt-6 w-full rounded-lg bg-blue-700 px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300 sm:w-auto"
      >
        {create.isPending ? "분석 요청 중…" : "분석 시작"}
      </button>
    </form>
  );
}
