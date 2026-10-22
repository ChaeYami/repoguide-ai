import type { FailureCode } from "@repoguide/shared";
import { EMPTY_USAGE, type AnalysesRepository, type AnalysisRow } from "../db/repositories/analyses.js";

// 인프로세스 분석 워커 (research R10). 작업 큐는 analyses 테이블이며, 임대(lease)와 하트비트로
// 프로세스가 죽어도 임대 만료 후 다른 워커가 이어받는다. 최대 시도 횟수를 넘으면 실패로 끝낸다.

export type AnalysisHandler = (analysis: AnalysisRow, signal: AbortSignal) => Promise<void>;

export interface WorkerLogger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export interface WorkerOptions {
  analyses: AnalysesRepository;
  handler: AnalysisHandler;
  concurrency: number;
  runTimeoutMs: number;
  workerId?: string;
  leaseMs?: number;
  heartbeatMs?: number;
  maxAttempts?: number;
  pollIntervalMs?: number;
  stopGraceMs?: number;
  logger?: WorkerLogger;
}

export class RunTimeoutError extends Error {
  constructor() {
    super("analysis run timed out");
    this.name = "RunTimeoutError";
  }
}

const silent: WorkerLogger = { info() {}, warn() {}, error() {} };
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createWorker(options: WorkerOptions) {
  const workerId = options.workerId ?? `worker-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
  const leaseMs = options.leaseMs ?? 60_000;
  const heartbeatMs = options.heartbeatMs ?? 20_000;
  const maxAttempts = options.maxAttempts ?? 2;
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  const log = options.logger ?? silent;
  const { analyses } = options;

  let stopping = false;
  const loops: Promise<void>[] = [];
  const inFlight = new Set<Promise<void>>();

  async function failIfStillRunning(id: string, code: FailureCode) {
    const row = await analyses.getById(id);
    if (row && row.status === "running" && row.leaseOwner === workerId) {
      await analyses.finish(id, { status: "failed", failureCode: code, usage: row.usage ?? EMPTY_USAGE });
    }
  }

  async function processAnalysis(row: AnalysisRow) {
    if (row.attemptCount > maxAttempts) {
      log.warn({ analysisId: row.id, attempts: row.attemptCount }, "attempt limit exceeded");
      await analyses.finish(row.id, { status: "failed", failureCode: "internal_error", usage: row.usage });
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new RunTimeoutError()), options.runTimeoutMs);
    const heartbeat = setInterval(() => {
      analyses
        .extendLease(row.id, workerId, leaseMs)
        .then((owned) => {
          if (!owned) controller.abort(new Error("lease lost"));
        })
        .catch((error: unknown) => log.warn({ err: error, analysisId: row.id }, "lease extension failed"));
    }, heartbeatMs);

    try {
      log.info({ analysisId: row.id, attempt: row.attemptCount }, "analysis started");
      await options.handler(row, controller.signal);
    } catch (error) {
      log.error({ err: error, analysisId: row.id }, "analysis handler failed");
    } finally {
      clearTimeout(timeout);
      clearInterval(heartbeat);
    }
    // 핸들러는 직접 상태를 끝맺어야 한다. 그러지 못했으면 원인에 맞게 실패로 기록한다.
    await failIfStillRunning(
      row.id,
      controller.signal.reason instanceof RunTimeoutError ? "timeout" : "internal_error",
    );
  }

  /** 작업 하나를 가져와 처리한다. 가져올 작업이 없으면 false. */
  async function runOnce(): Promise<boolean> {
    const row = await analyses.claimNext(workerId, leaseMs);
    if (!row) return false;
    const run = processAnalysis(row).catch((error: unknown) => log.error({ err: error, analysisId: row.id }, "worker failure"));
    inFlight.add(run);
    await run;
    inFlight.delete(run);
    return true;
  }

  async function loop() {
    while (!stopping) {
      try {
        if (!(await runOnce())) await delay(pollIntervalMs);
      } catch (error) {
        log.error({ err: error }, "worker poll failed");
        await delay(pollIntervalMs);
      }
    }
  }

  return {
    workerId,
    runOnce,
    start() {
      stopping = false;
      for (let i = 0; i < options.concurrency; i += 1) loops.push(loop());
      log.info({ workerId, concurrency: options.concurrency }, "worker started");
    },
    /** 새 작업을 받지 않고, 진행 중인 작업을 잠시 기다린다. 끝나지 않은 작업은 임대 만료 후 재시도된다. */
    async stop() {
      stopping = true;
      await Promise.race([Promise.all([...inFlight]), delay(options.stopGraceMs ?? 10_000)]);
    },
  };
}

export type Worker = ReturnType<typeof createWorker>;
