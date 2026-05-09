/**
 * log helper の最小 test。fmtDuration の境界値、log/warn の prefix 構造を検証する。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fmtDuration, log, warn } from "./log.js";

describe("fmtDuration", () => {
  it("1 秒未満は ms 表示", () => {
    expect(fmtDuration(0)).toStrictEqual("0ms");
    expect(fmtDuration(123)).toStrictEqual("123ms");
    expect(fmtDuration(999)).toStrictEqual("999ms");
  });

  it("1 分未満は s 表示 (小数 1 桁)", () => {
    expect(fmtDuration(1000)).toStrictEqual("1.0s");
    expect(fmtDuration(12_345)).toStrictEqual("12.3s");
    expect(fmtDuration(59_999)).toStrictEqual("60.0s");
  });

  it("1 分以上は m と s で分解", () => {
    expect(fmtDuration(60_000)).toStrictEqual("1m00s");
    expect(fmtDuration(125_000)).toStrictEqual("2m05s");
    expect(fmtDuration(3_600_000)).toStrictEqual("60m00s");
  });
});

describe("log / warn output format", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("log は `[HH:MM:SS] [+Xs] scope msg` 形式の 1 行を console.log に出す", () => {
    log("[review pr-7]", "claude completed in 89s");
    expect(logSpy).toHaveBeenCalledTimes(1);
    const out = logSpy.mock.calls[0][0] as string;
    expect(out).toMatch(
      /^\[\d{2}:\d{2}:\d{2}\] \[\+\d+s\] \[review pr-7\] claude completed in 89s$/,
    );
  });

  it("warn (err 無し) は console.warn に同フォーマットで 1 引数", () => {
    warn("[fix pr-9]", "claude timed out");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]).toHaveLength(1);
    const out = warnSpy.mock.calls[0][0] as string;
    expect(out).toMatch(/^\[\d{2}:\d{2}:\d{2}\] \[\+\d+s\] \[fix pr-9\] claude timed out$/);
  });

  it("warn (err 付き) は 2 引数で err を 2 番目に渡す", () => {
    const err = new Error("boom");
    warn("[fix pr-9]", "removeWorktree error:", err);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]).toHaveLength(2);
    expect(warnSpy.mock.calls[0][1]).toStrictEqual(err);
  });
});
