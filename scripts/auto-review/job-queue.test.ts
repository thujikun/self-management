/**
 * Job queue の dedup / per-PR mutex / 並行度上限 / 例外時の継続性の test。
 *
 * 弱い matcher 禁止 (testing.md): 結果は配列 / 数値で固定し、`toStrictEqual` または
 * `toBeGreaterThan` を使う。`.toBe(true)` 系は使わない。
 */

import { describe, expect, it } from "vitest";

import { JobQueue, type Job } from "./job-queue.js";

function makeJob(id: string, prNumber: number, run: () => Promise<void>): Job {
  return { id, prNumber, type: "review", run };
}

describe("JobQueue", () => {
  it("dedup: 同 id を 2 度 enqueue しても 1 件しか走らない", async () => {
    const q = new JobQueue({ maxConcurrent: 2 });
    let calls = 0;
    const job: Job = makeJob("a", 1, async () => {
      calls++;
    });
    const r1 = q.enqueue(job);
    const r2 = q.enqueue(job);
    await q.waitIdle();
    expect({ r1, r2, calls }).toStrictEqual({ r1: true, r2: false, calls: 1 });
  });

  it("並行度上限を守る (maxConcurrent=2 で同時 in-flight は 2 件まで)", async () => {
    const q = new JobQueue({ maxConcurrent: 2 });
    let inFlight = 0;
    let peakInFlight = 0;
    const ticket = (id: string, pr: number, ms: number): Job =>
      makeJob(id, pr, async () => {
        inFlight++;
        if (inFlight > peakInFlight) peakInFlight = inFlight;
        await new Promise((r) => setTimeout(r, ms));
        inFlight--;
      });
    q.enqueue(ticket("a", 1, 30));
    q.enqueue(ticket("b", 2, 30));
    q.enqueue(ticket("c", 3, 30));
    q.enqueue(ticket("d", 4, 30));
    await q.waitIdle();
    expect(peakInFlight).toStrictEqual(2);
  });

  it("per-PR mutex: 同 PR の review 終了後にしか fix が start しない", async () => {
    const q = new JobQueue({ maxConcurrent: 4 });
    const log: string[] = [];
    const ticket = (id: string, pr: number, ms: number): Job =>
      makeJob(id, pr, async () => {
        log.push(`${id}-start`);
        await new Promise((r) => setTimeout(r, ms));
        log.push(`${id}-end`);
      });
    q.enqueue(ticket("review-pr7", 7, 40));
    q.enqueue(ticket("fix-pr7", 7, 20));
    q.enqueue(ticket("review-pr8", 8, 40));
    await q.waitIdle();
    // PR 7 の 2 件が overlap していないこと: fix-pr7 の start は review-pr7 の end より後
    expect(log.indexOf("fix-pr7-start")).toBeGreaterThan(log.indexOf("review-pr7-end"));
  });

  it("job が throw しても queue は止まらず後続を実行する", async () => {
    const q = new JobQueue({ maxConcurrent: 2 });
    const log: string[] = [];
    q.enqueue(
      makeJob("bad", 1, async () => {
        log.push("bad-thrown");
        throw new Error("boom");
      }),
    );
    q.enqueue(
      makeJob("ok", 2, async () => {
        log.push("ok-done");
      }),
    );
    await q.waitIdle();
    expect([...log].sort()).toStrictEqual(["bad-thrown", "ok-done"]);
  });

  it("status は queued / running の件数を返す", async () => {
    const q = new JobQueue({ maxConcurrent: 1 });
    let release: (() => void) | undefined;
    const blocker = new Promise<void>((r) => {
      release = r;
    });
    q.enqueue(makeJob("running", 1, () => blocker));
    q.enqueue(makeJob("queued", 2, async () => undefined));
    // queue が動き出すのを待ってから観測
    await new Promise((r) => setTimeout(r, 10));
    const mid = q.status();
    release?.();
    await q.waitIdle();
    const final = q.status();
    expect({ mid, final }).toStrictEqual({
      mid: { queued: 1, running: 1 },
      final: { queued: 0, running: 0 },
    });
  });
});
