/**
 * pr-fetch.ts の純粋関数 test。`gh` CLI を直接叩く `listOpenPRs` / `getBotVerdictComments` /
 * `fetchPrChecks` は副作用 wrapper なので test 対象外、ここでは pure な集計 / 分類 / 判定関数のみ。
 *
 * - `summarizeCiStatus`: bucket 配列から "pass" | "fail" | "pending" への集約
 * - `extractFailingChecks`: bucket=fail entries から runId を URL parse して FailingCheck[] を返す
 * - `isWipTitle`: PR title の [WIP] / WIP: prefix 判定
 * - `isNoChecksReportedError`: gh CLI の "no checks reported" stderr の正規化判定
 */

import { describe, expect, it } from "vitest";

import {
  extractFailingChecks,
  isNoChecksReportedError,
  isWipTitle,
  summarizeCiStatus,
  type CheckEntry,
} from "./pr-fetch.js";

const passCheck = (name: string): CheckEntry => ({ bucket: "pass", name, link: "" });
const failCheck = (name: string, runId: string): CheckEntry => ({
  bucket: "fail",
  name,
  link: `https://github.com/x/y/actions/runs/${runId}/job/9999`,
});
const skipCheck = (name: string): CheckEntry => ({ bucket: "skipping", name, link: "" });
const pendingCheck = (name: string): CheckEntry => ({ bucket: "pending", name, link: "" });

describe("summarizeCiStatus", () => {
  it("0 件: pending (= 未準備扱い)", () => {
    expect(summarizeCiStatus([])).toStrictEqual("pending");
  });

  it("全 pass: pass", () => {
    expect(summarizeCiStatus([passCheck("a"), passCheck("b")])).toStrictEqual("pass");
  });

  it("全 skipping: pass (CI 全体として通った扱い)", () => {
    expect(summarizeCiStatus([skipCheck("a"), skipCheck("b")])).toStrictEqual("pass");
  });

  it("pass + skipping 混在: pass", () => {
    expect(summarizeCiStatus([passCheck("a"), skipCheck("b")])).toStrictEqual("pass");
  });

  it("1 件でも fail があれば fail (pass 同居も無視)", () => {
    expect(summarizeCiStatus([passCheck("a"), failCheck("b", "1")])).toStrictEqual("fail");
  });

  it("pending と pass の混在: pending (進行中扱い)", () => {
    expect(summarizeCiStatus([passCheck("a"), pendingCheck("b")])).toStrictEqual("pending");
  });

  it("pending のみ: pending", () => {
    expect(summarizeCiStatus([pendingCheck("a")])).toStrictEqual("pending");
  });
});

describe("extractFailingChecks", () => {
  it("bucket=fail + URL parse 成功: FailingCheck を抽出", () => {
    const out = extractFailingChecks([
      passCheck("ok"),
      failCheck("typecheck", "123"),
      failCheck("test", "456"),
    ]);
    expect(out).toStrictEqual([
      {
        name: "typecheck",
        runId: "123",
        jobUrl: "https://github.com/x/y/actions/runs/123/job/9999",
      },
      {
        name: "test",
        runId: "456",
        jobUrl: "https://github.com/x/y/actions/runs/456/job/9999",
      },
    ]);
  });

  it("bucket=fail だが URL に /actions/runs/<id>/ が無い: silent skip", () => {
    const out = extractFailingChecks([
      { bucket: "fail", name: "weird", link: "https://example.com/no-runs-here" },
      { bucket: "fail", name: "empty", link: "" },
    ]);
    expect(out).toStrictEqual([]);
  });

  it("fail entry 無し: 空配列", () => {
    expect(extractFailingChecks([passCheck("a"), skipCheck("b")])).toStrictEqual([]);
  });

  it("0 件入力: 空配列", () => {
    expect(extractFailingChecks([])).toStrictEqual([]);
  });

  it("fail + URL parseable / fail + URL unparseable 混在: parseable のみ抽出", () => {
    const out = extractFailingChecks([
      failCheck("good", "789"),
      { bucket: "fail", name: "bad", link: "garbage" },
    ]);
    expect(out).toStrictEqual([
      {
        name: "good",
        runId: "789",
        jobUrl: "https://github.com/x/y/actions/runs/789/job/9999",
      },
    ]);
  });
});

describe("isWipTitle", () => {
  it("`[WIP] foo`: hit", () => {
    expect(isWipTitle("[WIP] foo")).toStrictEqual(true);
  });

  it("`WIP: foo`: hit", () => {
    expect(isWipTitle("WIP: foo")).toStrictEqual(true);
  });

  it("`wip foo` (lower-case): hit", () => {
    expect(isWipTitle("wip foo")).toStrictEqual(true);
  });

  it("先頭 space あり `  [WIP] foo`: hit (前 trim 許容)", () => {
    expect(isWipTitle("  [WIP] foo")).toStrictEqual(true);
  });

  it("`wip-feature` (空白 / colon が続かない): miss (単語 boundary 不足)", () => {
    expect(isWipTitle("wip-feature")).toStrictEqual(false);
  });

  it("通常 PR title (`feat: foo`): miss", () => {
    expect(isWipTitle("feat: add new thing")).toStrictEqual(false);
  });

  it("空文字: miss", () => {
    expect(isWipTitle("")).toStrictEqual(false);
  });
});

describe("isNoChecksReportedError", () => {
  it("stderr に 'no checks reported': true", () => {
    expect(
      isNoChecksReportedError({
        stderr: "no checks reported on the 'feat/x' branch",
      }),
    ).toStrictEqual(true);
  });

  it("stderr に 'No Checks Reported' (case-insensitive): true", () => {
    expect(isNoChecksReportedError({ stderr: "No Checks Reported" })).toStrictEqual(true);
  });

  it("stderr に別 error: false", () => {
    expect(isNoChecksReportedError({ stderr: "HTTP 502" })).toStrictEqual(false);
  });

  it("null: false (Error 形を成さない値)", () => {
    expect(isNoChecksReportedError(null)).toStrictEqual(false);
  });

  it("undefined: false", () => {
    expect(isNoChecksReportedError(undefined)).toStrictEqual(false);
  });

  it("stderr 不在の object: false", () => {
    expect(isNoChecksReportedError({ other: "field" })).toStrictEqual(false);
  });

  it("stderr が string でない: false", () => {
    expect(isNoChecksReportedError({ stderr: 42 })).toStrictEqual(false);
  });
});
