/**
 * Job queue with bounded concurrency + per-PR mutex。
 *
 * - 同 id の job は dedup (キュー内 / running 中 ともに重複拒否)
 * - 同 PR の異 job (review と fix) は直列化 (片方が走ってる間はもう片方を待たせる)
 * - 別 PR は最大 maxConcurrent まで並列
 */

import { log, warn } from "./log.js";

export interface Job {
  /** dedup key。同値が queued / running なら enqueue 拒否。 */
  id: string;
  prNumber: number;
  /** 区別ログ用の type ラベル。 */
  type: "review" | "fix" | "merge" | "update-branch" | "conflict-fix";
  /** 実行関数。throw しても queue は止めない (`console.error` でログのみ)。 */
  run: () => Promise<void>;
}

export interface JobQueueOptions {
  maxConcurrent: number;
}

export class JobQueue {
  private readonly maxConcurrent: number;
  private readonly queue: Job[] = [];
  private readonly running = new Set<string>();
  private readonly runningPRs = new Set<number>();

  constructor(opts: JobQueueOptions) {
    if (opts.maxConcurrent < 1) throw new Error("maxConcurrent must be >= 1");
    this.maxConcurrent = opts.maxConcurrent;
  }

  /** queue に追加。dedup OK なら true、重複なら false。 */
  enqueue(job: Job): boolean {
    if (this.running.has(job.id)) return false;
    if (this.queue.some((j) => j.id === job.id)) return false;
    this.queue.push(job);
    queueMicrotask(() => this.process());
    return true;
  }

  /** queued / running 件数を観測する (test 用)。 */
  status(): { queued: number; running: number } {
    return { queued: this.queue.length, running: this.running.size };
  }

  /** queue + running が空になるまで待つ。 */
  async waitIdle(pollMs = 50): Promise<void> {
    while (this.queue.length > 0 || this.running.size > 0) {
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }

  /** 内部: 走らせられる job を全部 kick する。 */
  private process(): void {
    while (this.running.size < this.maxConcurrent) {
      // per-PR mutex: 同 PR が running 中の場合は当該 job を queue 後尾に置いてスキップ
      const idx = this.queue.findIndex((j) => !this.runningPRs.has(j.prNumber));
      if (idx === -1) break;
      const job = this.queue.splice(idx, 1)[0];
      this.start(job);
    }
  }

  private start(job: Job): void {
    this.running.add(job.id);
    this.runningPRs.add(job.prNumber);
    log(
      `[job ${job.id}]`,
      `picked from queue (running=${this.running.size}/${this.maxConcurrent})`,
    );
    job
      .run()
      .catch((err) => {
        warn(`[job ${job.id}]`, `unhandled error:`, err);
      })
      .finally(() => {
        this.running.delete(job.id);
        this.runningPRs.delete(job.prNumber);
        log(
          `[job ${job.id}]`,
          `released (queued=${this.queue.length}, running=${this.running.size})`,
        );
        // 1 件終わったら次を kick
        queueMicrotask(() => this.process());
      });
  }
}
