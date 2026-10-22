import type { AnalysisStage, Progress, ProgressActivity } from "@repoguide/shared";
import type { AnalysesRepository } from "../db/repositories/analyses.js";

// 진행 상태 갱신과 하트비트 (FR-018, SC-002, research R11).
// 단계 전환·파일 진행 때 갱신하고, LLM 호출처럼 오래 걸리는 동안에는 heartbeatMs마다 updatedAt을 갱신한다.

export const DEFAULT_HEARTBEAT_MS = 10_000;

type ProgressChange = Partial<Omit<Progress, "updatedAt">> & { stage?: AnalysisStage };

export class ProgressReporter {
  private current: Progress;

  constructor(
    private readonly analyses: Pick<AnalysesRepository, "updateProgress">,
    private readonly analysisId: string,
    initial: Progress,
    private readonly options: { heartbeatMs?: number; now?: () => Date } = {},
  ) {
    this.current = initial;
  }

  get progress(): Progress {
    return this.current;
  }

  async update(change: ProgressChange = {}): Promise<void> {
    const { stage, ...progress } = change;
    this.current = { ...this.current, ...progress, updatedAt: (this.options.now?.() ?? new Date()).toISOString() };
    await this.analyses.updateProgress(this.analysisId, { ...(stage ? { stage } : {}), progress: this.current });
  }

  /** 작업이 끝날 때까지 활동을 표시하고 하트비트를 보낸다. */
  async withActivity<T>(activity: ProgressActivity, task: () => Promise<T>): Promise<T> {
    await this.update({ activity });
    const timer = setInterval(() => {
      this.update().catch(() => {});
    }, this.options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS);
    try {
      return await task();
    } finally {
      clearInterval(timer);
      await this.update({ activity: null });
    }
  }
}
