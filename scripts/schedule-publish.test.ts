/**
 * `schedule-publish.ts` の pure 関数の分岐網羅 test。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business shouldPublish / stripDraftLine / extractMeta / evaluatePost の分岐網羅 test。datetime + TZ offset と date-only 両形式の publishedAt 比較、draft フラグの有無、frontmatter 形状の崩れに対する no-op 挙動を確認
 * @graph-connects none
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  evaluateDirectory,
  evaluatePost,
  extractMeta,
  shouldPublish,
  slugOfFilename,
  stripDraftLine,
} from "./schedule-publish.js";

describe("shouldPublish", () => {
  it("date-only 過去なら true", () => {
    expect(shouldPublish("2025-01-01", new Date("2026-01-01T00:00:00Z"))).toBe(true);
  });

  it("date-only 未来なら false", () => {
    expect(shouldPublish("2027-01-01", new Date("2026-01-01T00:00:00Z"))).toBe(false);
  });

  it("date-only ちょうど (UTC 00:00) なら true", () => {
    expect(shouldPublish("2026-05-19", new Date("2026-05-19T00:00:00Z"))).toBe(true);
  });

  it("datetime JST 09:00 === UTC 00:00 として比較", () => {
    expect(shouldPublish("2026-05-19T09:00:00+09:00", new Date("2026-05-19T00:00:00Z"))).toBe(true);
    expect(shouldPublish("2026-05-19T09:00:00+09:00", new Date("2026-05-18T23:59:59Z"))).toBe(
      false,
    );
  });

  it("datetime PDT 08:00 === UTC 15:00 として比較", () => {
    expect(shouldPublish("2026-05-19T08:00:00-07:00", new Date("2026-05-19T15:00:00Z"))).toBe(true);
    expect(shouldPublish("2026-05-19T08:00:00-07:00", new Date("2026-05-19T14:59:59Z"))).toBe(
      false,
    );
  });

  it("parse 不能な文字列は false (= 公開しない安全側)", () => {
    expect(shouldPublish("not-a-date", new Date("2026-05-19T00:00:00Z"))).toBe(false);
  });
});

describe("stripDraftLine", () => {
  it("draft: true 行を消す", () => {
    const input = [
      "---",
      'title: "x"',
      "draft: true",
      'publishedAt: "2026-05-19"',
      "---",
      "body line",
      "",
    ].join("\n");
    const out = stripDraftLine(input);
    expect(out).not.toContain("draft:");
    expect(out).toContain('title: "x"');
    expect(out).toContain('publishedAt: "2026-05-19"');
    expect(out).toContain("body line");
  });

  it("draft: false は no-op", () => {
    const input = [
      "---",
      'title: "x"',
      "draft: false",
      'publishedAt: "2026-05-19"',
      "---",
      "body",
      "",
    ].join("\n");
    expect(stripDraftLine(input)).toBe(input);
  });

  it("draft 自体が無ければ no-op", () => {
    const input = ["---", 'title: "x"', 'publishedAt: "2026-05-19"', "---", "body", ""].join("\n");
    expect(stripDraftLine(input)).toBe(input);
  });

  it("frontmatter が無ければ no-op", () => {
    const input = "no frontmatter here\ndraft: true\n";
    expect(stripDraftLine(input)).toBe(input);
  });

  it("本文中の 'draft: true' 文字列は消さない (frontmatter 内のみ対象)", () => {
    const input = [
      "---",
      'title: "x"',
      'publishedAt: "2026-05-19"',
      "---",
      "Example: draft: true",
      "",
    ].join("\n");
    expect(stripDraftLine(input)).toBe(input);
  });

  it("CRLF 改行も扱える", () => {
    const input = ["---", 'title: "x"', "draft: true", "---", "body", ""].join("\r\n");
    const out = stripDraftLine(input);
    expect(out).not.toContain("draft:");
    expect(out).toContain('title: "x"');
  });
});

describe("extractMeta", () => {
  it("publishedAt と draft: true を両方読む", () => {
    const md = [
      "---",
      'title: "x"',
      'publishedAt: "2026-05-19T09:00:00+09:00"',
      "draft: true",
      "---",
      "body",
    ].join("\n");
    expect(extractMeta(md)).toStrictEqual({
      publishedAt: "2026-05-19T09:00:00+09:00",
      draft: true,
    });
  });

  it("draft: false なら draft=false", () => {
    const md = ["---", 'publishedAt: "2026-05-19"', "draft: false", "---"].join("\n");
    expect(extractMeta(md).draft).toBe(false);
  });

  it("クォート無し publishedAt も読める", () => {
    const md = ["---", "publishedAt: 2026-05-19", "---"].join("\n");
    expect(extractMeta(md).publishedAt).toBe("2026-05-19");
  });

  it("シングルクォートでも読める", () => {
    const md = ["---", "publishedAt: '2026-05-19'", "---"].join("\n");
    expect(extractMeta(md).publishedAt).toBe("2026-05-19");
  });

  it("frontmatter が無ければ全部 null/false", () => {
    expect(extractMeta("no frontmatter")).toStrictEqual({ publishedAt: null, draft: false });
  });
});

describe("slugOfFilename", () => {
  it(".en.md / .ja.md から slug 抽出", () => {
    expect(slugOfFilename("cortex-product-graph.ja.md")).toBe("cortex-product-graph");
    expect(slugOfFilename("cortex-product-graph.en.md")).toBe("cortex-product-graph");
  });

  it("マッチしなければ filename そのまま", () => {
    expect(slugOfFilename("foo.md")).toBe("foo.md");
  });
});

describe("evaluatePost", () => {
  const now = new Date("2026-05-19T09:00:00Z");

  it("draft + publishedAt 過去 → changed:true", () => {
    const md = ["---", 'publishedAt: "2026-05-19"', "draft: true", "---", "body"].join("\n");
    const ev = evaluatePost("post.ja.md", md, now);
    expect(ev.changed).toBe(true);
    expect(ev.newContent).toBeDefined();
    expect(ev.newContent).not.toContain("draft:");
    expect(ev.slug).toBe("post");
  });

  it("draft + publishedAt 未来 → changed:false", () => {
    const md = ["---", 'publishedAt: "2027-05-19"', "draft: true", "---", "body"].join("\n");
    expect(evaluatePost("post.ja.md", md, now).changed).toBe(false);
  });

  it("draft 無し → changed:false (= 既 published)", () => {
    const md = ["---", 'publishedAt: "2025-05-19"', "---", "body"].join("\n");
    expect(evaluatePost("post.ja.md", md, now).changed).toBe(false);
  });

  it("publishedAt 無し + draft あり → changed:false (= 不正、放置)", () => {
    const md = ["---", "draft: true", 'title: "x"', "---", "body"].join("\n");
    expect(evaluatePost("post.ja.md", md, now).changed).toBe(false);
  });

  it("`_` prefix slug (test fixture) は changed:false で skip", () => {
    const md = ["---", 'publishedAt: "2020-01-01"', "draft: true", "---", "body"].join("\n");
    expect(evaluatePost("_draft-example.en.md", md, now).changed).toBe(false);
  });

  it("TZ offset 込み datetime も判定できる", () => {
    const md = ["---", 'publishedAt: "2026-05-19T09:00:00+09:00"', "draft: true", "---"].join("\n");
    // now = 2026-05-19T09:00:00Z; publishedAt = JST 9 AM = UTC 00:00 = 過去
    expect(evaluatePost("post.ja.md", md, now).changed).toBe(true);
  });
});

describe("evaluateDirectory", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "schedule-publish-test-"));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("ディレクトリ内の md を全部 evaluate", async () => {
    const now = new Date("2026-05-19T09:00:00Z");
    await writeFile(
      join(tmp, "ready.ja.md"),
      ["---", 'publishedAt: "2026-05-01"', "draft: true", "---", "body"].join("\n"),
      "utf8",
    );
    await writeFile(
      join(tmp, "future.ja.md"),
      ["---", 'publishedAt: "2027-01-01"', "draft: true", "---", "body"].join("\n"),
      "utf8",
    );
    await writeFile(
      join(tmp, "published.ja.md"),
      ["---", 'publishedAt: "2026-05-01"', "---", "body"].join("\n"),
      "utf8",
    );

    const evals = await evaluateDirectory(tmp, now);
    const bySlug = Object.fromEntries(evals.map((e) => [e.slug, e]));
    expect(bySlug["ready"]?.changed).toBe(true);
    expect(bySlug["future"]?.changed).toBe(false);
    expect(bySlug["published"]?.changed).toBe(false);
  });

  it("md 以外は無視", async () => {
    await writeFile(join(tmp, "ignore.txt"), "draft: true", "utf8");
    const evals = await evaluateDirectory(tmp, new Date("2026-05-19T09:00:00Z"));
    expect(evals).toHaveLength(0);
  });
});
