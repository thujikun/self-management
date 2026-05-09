/**
 * state.ts の atomic load/save round-trip + setPR の immutable update + StateMutex の直列化 test。
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getPR, loadState, saveState, setGlobal, setPR, StateMutex, type State } from "./state.js";

let tmpDir: string;
let path: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "self-mgmt-auto-review-state-"));
  path = join(tmpDir, "state.json");
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("loadState / saveState", () => {
  it("存在しない path は空 state を返す (ENOENT を吸収)", async () => {
    expect(await loadState(path)).toStrictEqual({ prs: {} });
  });

  it("save → load で round-trip 一致", async () => {
    const before: State = {
      prs: {
        "5": {
          lastReviewedSha: "abc123",
          lastReviewedAt: "2026-05-09T00:00:00Z",
          iterations: 1,
        },
      },
    };
    await saveState(before, path);
    expect(await loadState(path)).toStrictEqual(before);
  });

  it("atomic write (tmp → rename) で書き出される", async () => {
    await saveState({ prs: { "1": { iterations: 0 } } }, path);
    const raw = await readFile(path, "utf8");
    expect(JSON.parse(raw)).toStrictEqual({ prs: { "1": { iterations: 0 } } });
  });
});

describe("getPR / setPR", () => {
  it("getPR は未登録 PR で iterations: 0 の空 state", () => {
    expect(getPR({ prs: {} }, 7)).toStrictEqual({ iterations: 0 });
  });

  it("setPR は immutable に partial 更新する", () => {
    const before: State = { prs: { "5": { iterations: 1 } } };
    const after = setPR(before, 5, { lastReviewedSha: "abc" });
    expect(after).toStrictEqual({
      prs: { "5": { iterations: 1, lastReviewedSha: "abc" } },
    });
    // 元の参照は不変
    expect(before).toStrictEqual({ prs: { "5": { iterations: 1 } } });
  });

  it("setPR は他 PR の state を保持する", () => {
    const before: State = {
      prs: { "5": { iterations: 1 }, "7": { iterations: 0 } },
    };
    const after = setPR(before, 5, { iterations: 2 });
    expect(after.prs).toStrictEqual({
      "5": { iterations: 2 },
      "7": { iterations: 0 },
    });
  });

  it("setPR は merge 用 field (lastMergedSha / lastMergedAt) も partial 更新できる", () => {
    const before: State = { prs: { "9": { iterations: 1 } } };
    const after = setPR(before, 9, {
      lastMergedSha: "merged-sha",
      lastMergedAt: "2026-05-09T01:00:00Z",
    });
    expect(after.prs["9"]).toStrictEqual({
      iterations: 1,
      lastMergedSha: "merged-sha",
      lastMergedAt: "2026-05-09T01:00:00Z",
    });
  });

  it("setGlobal は global state を partial 更新 (immutable copy 返却、prs は触らず)", () => {
    const before: State = { prs: { "5": { iterations: 1 } } };
    const after = setGlobal(before, {
      lastIndexedMainSha: "main-1",
      lastIndexedAt: "2026-05-09T02:00:00Z",
    });
    expect(after).toStrictEqual({
      prs: { "5": { iterations: 1 } },
      global: { lastIndexedMainSha: "main-1", lastIndexedAt: "2026-05-09T02:00:00Z" },
    });
    // 元の参照は不変
    expect(before).toStrictEqual({ prs: { "5": { iterations: 1 } } });
  });

  it("setGlobal は既存 global field を保持しつつ新 field を merge する", () => {
    const before: State = {
      prs: {},
      global: { lastIndexedMainSha: "old-sha", lastIndexedAt: "2026-05-09T00:00:00Z" },
    };
    const after = setGlobal(before, { lastIndexedMainSha: "new-sha" });
    expect(after.global).toStrictEqual({
      lastIndexedMainSha: "new-sha",
      lastIndexedAt: "2026-05-09T00:00:00Z",
    });
  });
});

describe("StateMutex", () => {
  it("並行 update が直列化されて lost write が起きない", async () => {
    const mutex = new StateMutex();
    let state: State = { prs: {} };
    const apply = async (next: State): Promise<void> => {
      // 模擬的な write 待ち (race を起こしうる場面)
      await new Promise((r) => setTimeout(r, 5));
      state = next;
    };

    const u1 = mutex.update(
      () => state,
      apply,
      (s) => setPR(s, 5, { iterations: 1 }),
    );
    const u2 = mutex.update(
      () => state,
      apply,
      (s) => setPR(s, 7, { iterations: 1 }),
    );
    const u3 = mutex.update(
      () => state,
      apply,
      (s) => setPR(s, 5, { iterations: 2 }),
    );

    await Promise.all([u1, u2, u3]);

    // 3 件の update がすべて適用されている (どれも lost していない)
    expect(state.prs).toStrictEqual({
      "5": { iterations: 2 },
      "7": { iterations: 1 },
    });
  });

  it("途中の reject で chain が止まらず後続も実行される", async () => {
    const mutex = new StateMutex();
    let state: State = { prs: {} };
    const apply = async (next: State): Promise<void> => {
      state = next;
    };

    const fail = mutex.update(
      () => state,
      apply,
      () => {
        throw new Error("boom");
      },
    );
    const ok = mutex.update(
      () => state,
      apply,
      (s) => setPR(s, 9, { iterations: 1 }),
    );

    await expect(fail).rejects.toThrow("boom");
    await ok;
    expect(state.prs).toStrictEqual({ "9": { iterations: 1 } });
  });
});
