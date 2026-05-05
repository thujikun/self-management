/**
 * `operations-log.ts` の pure helper unit tests。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business operations/log.md parser の純粋ロジック (parseDateFromTitle / slugify / splitH2Sections / parseOperationsLog) の網羅テスト。日付・JST/UTC 変換・section 分割・引数 path 処理など正常系と境界条件を抑える
 * @graph-connects none
 */

import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  parseDateFromTitle,
  parseOperationsLog,
  slugify,
  splitH2Sections,
} from "./operations-log.js";

describe("parseDateFromTitle", () => {
  it("YYYY-MM-DD HH:MM JST → JST→UTC 9 時間引き", () => {
    expect(parseDateFromTitle("2026-05-04 23:46 JST - thread posted: dbgraph")).toBe(
      "2026-05-04T14:46:00Z",
    );
  });

  it("JST 早朝は前日にロールオーバ", () => {
    expect(parseDateFromTitle("2026-05-05 02:30 JST - midnight action")).toBe(
      "2026-05-04T17:30:00Z",
    );
  });

  it("YYYY-MM-DD only は日付の頭", () => {
    expect(parseDateFromTitle("2026-05-04 - daily summary")).toBe("2026-05-04T00:00:00Z");
  });

  it("YYYY-MM-DD 〜 YYYY-MM-DD range は開始日", () => {
    expect(parseDateFromTitle("2026-05-01 〜 2026-05-02 (英語アカウントへの reboot)")).toBe(
      "2026-05-01T00:00:00Z",
    );
  });

  it("日付なし → null", () => {
    expect(parseDateFromTitle("学び (`memory/feedback_x_thread_workflow.md` も参照)")).toBeNull();
  });
});

describe("slugify", () => {
  it("スペースをハイフンに、英数字以外を除去", () => {
    expect(slugify("Hello World!")).toBe("hello-world");
  });

  it("日本語は \\w に含まれないため除去 → 余分な hyphen が連続で残る (受容)", () => {
    expect(slugify("こんにちは hello")).toBe("-hello");
  });

  it("80 字 cap", () => {
    const long = "a".repeat(200);
    expect(slugify(long).length).toBe(80);
  });

  it("空文字 → 空", () => {
    expect(slugify("")).toBe("");
  });
});

describe("splitH2Sections", () => {
  it("基本: H2 で分割、H3 は body に含める", () => {
    const md = "# Title\n\n## Section A\nbody a1\n### sub a\nsub body\n\n## Section B\nbody b\n";
    const sections = splitH2Sections(md);
    expect(sections).toHaveLength(2);
    expect(sections[0].title).toBe("Section A");
    expect(sections[0].body).toContain("body a1");
    expect(sections[0].body).toContain("### sub a");
    expect(sections[1].title).toBe("Section B");
    expect(sections[1].body).toBe("body b");
  });

  it("先頭 (H2 前のテキスト) は捨てられる", () => {
    const md = "intro text\n\n## Only Section\ncontent\n";
    const sections = splitH2Sections(md);
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe("Only Section");
  });

  it("H2 0 件 → 空配列", () => {
    expect(splitH2Sections("# Just H1\nno H2 here")).toEqual([]);
  });

  it("複数 H2 連続 (空 body)", () => {
    const md = "## A\n## B\n";
    const s = splitH2Sections(md);
    expect(s).toHaveLength(2);
    expect(s[0].title).toBe("A");
    expect(s[1].title).toBe("B");
  });
});

describe("parseOperationsLog (integration with fixture file)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ops-log-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("日付なし section は skip、日付あり section が release_note になる", async () => {
    const path = join(dir, "log.md");
    await writeFile(
      path,
      "# Operations log\n\n" +
        "## 2026-05-04 23:46 JST - thread posted\nthread body\n\n" +
        "## 学び\n散発的なメモ\n\n" +
        "## 2026-05-01 〜 2026-05-02 (reboot)\nreboot body\n",
      "utf8",
    );
    const result = await parseOperationsLog(path);
    expect(result.source).toBe("operations-log");
    expect(result.edges).toEqual([]);
    expect(result.nodes).toHaveLength(2);
    const titles = result.nodes.map((n) => n.fields.title as string);
    expect(titles).toContain("2026-05-04 23:46 JST - thread posted");
    expect(titles).toContain("2026-05-01 〜 2026-05-02 (reboot)");
  });

  it("各 release_note は body_summary を持つ", async () => {
    const path = join(dir, "log.md");
    await writeFile(
      path,
      "## 2026-05-04 23:46 JST - test\nimportant body content here\n",
      "utf8",
    );
    const result = await parseOperationsLog(path);
    expect(result.nodes).toHaveLength(1);
    const node = result.nodes[0];
    expect(node.kind).toBe("release_notes");
    expect(node.body_summary).toContain("test");
    expect(node.body_summary).toContain("important body content");
  });

  it("body_summary は内部 H3 を除去", async () => {
    const path = join(dir, "log.md");
    await writeFile(
      path,
      "## 2026-05-04 23:46 JST - x\n### sub\ntext below sub\n",
      "utf8",
    );
    const result = await parseOperationsLog(path);
    const summary = result.nodes[0].body_summary as string;
    expect(summary).not.toContain("### sub");
    expect(summary).toContain("text below sub");
  });

  it("日付なし section だけのファイル → 空 nodes", async () => {
    const path = join(dir, "log.md");
    await writeFile(path, "## 学び\nlessons\n", "utf8");
    const result = await parseOperationsLog(path);
    expect(result.nodes).toEqual([]);
  });
});
