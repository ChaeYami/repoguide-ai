import type { Level, Purpose, RegenerationRequest } from "@repoguide/shared";
import { useState } from "react";
import { FailureNotice } from "./FailureNotice";
import { LevelPicker } from "./LevelPicker";
import { PurposePicker } from "./PurposePicker";

// 수준·목적을 바꿔 매뉴얼 다시 만들기 (FR-032). 이미 읽은 파일을 재사용하므로 처음 분석보다 빠르다.

export interface RequestError {
  message: string;
  action?: string | null;
  retryAfterSec?: number | null;
}

export function RegeneratePanel(props: {
  level: Level;
  purpose: Purpose;
  pending: boolean;
  error: RequestError | null;
  onRegenerate: (request: RegenerationRequest) => void;
}) {
  const [level, setLevel] = useState<Level>(props.level);
  const [purpose, setPurpose] = useState<Purpose>(props.purpose);
  const unchanged = level === props.level && purpose === props.purpose;

  return (
    <section aria-labelledby="regenerate-heading" className="mt-10 rounded-lg border border-slate-200 p-4">
      <h2 id="regenerate-heading" className="text-lg font-semibold">
        다른 조건으로 다시 만들기
      </h2>
      <p className="mt-1 text-sm text-slate-600">이미 읽은 파일을 다시 쓰고, 새 조건에 필요한 파일만 더 읽습니다. 지금 매뉴얼은 그대로 남습니다.</p>
      <LevelPicker value={level} onChange={setLevel} />
      <PurposePicker value={purpose} onChange={setPurpose} />
      {props.error && <FailureNotice title="다시 만들지 못했습니다" {...props.error} />}
      <button
        type="button"
        disabled={unchanged || props.pending}
        onClick={() => props.onRegenerate({ mode: "change_options", level, purpose })}
        className="mt-4 w-full rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300 sm:w-auto"
      >
        {props.pending ? "요청 중…" : unchanged ? "수준이나 목적을 바꿔 주세요" : "이 조건으로 다시 만들기"}
      </button>
    </section>
  );
}
