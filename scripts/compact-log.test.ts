/**
 * compact-log.ts の pure logic test。filesystem 副作用なしで section 分割 / threshold /
 * bucket / archive 構築の整合性を担保。
 *
 * @graph-stack core
 * @graph-domain infra
 * @graph-business compact-log の section 分割 / 日付 threshold partitioning / archive 振り分けロジックの正確性を検証。md コンテキスト圧迫を防ぐ設計の単体動作を機械強制
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";
import {
  bucketByYearMonth,
  buildArchiveContent,
  buildRecentContent,
  parseSectionDate,
  partitionByThreshold,
  splitSections,
} from "./compact-log.js";

describe("parseSectionDate", () => {
  it("standard YYYY-MM-DD prefix", () => {
    const d = parseSectionDate("2026-05-04 23:30 JST - daily action");
    expect(d?.toISOString().slice(0, 10)).toBe("2026-05-04");
  });

  it("range prefix takes start date", () => {
    const d = parseSectionDate("2026-05-01 〜 2026-05-02 (reboot)");
    expect(d?.toISOString().slice(0, 10)).toBe("2026-05-01");
  });

  it("non-dated title returns null", () => {
    expect(parseSectionDate("学び (memory も参照)")).toBeNull();
    expect(parseSectionDate("残作業 (引き続き)")).toBeNull();
  });
});

describe("splitSections", () => {
  const md = `# operations log

prologue line.

## 2026-05-01 first
content of first
- bullet

## 2026-05-04 second
content of second

## 学び
non-dated section
`;

  it("captures prologue + 3 sections", () => {
    const { prologue, sections } = splitSections(md);
    expect(prologue).toContain("# operations log");
    expect(prologue).toContain("prologue line");
    expect(sections).toHaveLength(3);
    expect(sections[0].title).toBe("2026-05-01 first");
    expect(sections[1].title).toBe("2026-05-04 second");
    expect(sections[2].title).toBe("学び");
  });

  it("section.body includes its H2 line", () => {
    const { sections } = splitSections(md);
    expect(sections[0].body.startsWith("## 2026-05-01 first")).toBe(true);
    expect(sections[1].body).toContain("content of second");
  });

  it("dated sections get parsed date, undated get null", () => {
    const { sections } = splitSections(md);
    expect(sections[0].date?.toISOString().slice(0, 10)).toBe("2026-05-01");
    expect(sections[1].date?.toISOString().slice(0, 10)).toBe("2026-05-04");
    expect(sections[2].date).toBeNull();
  });
});

describe("partitionByThreshold", () => {
  const sections = [
    { title: "2026-05-01 old", date: new Date("2026-05-01T00:00:00Z"), body: "## 2026-05-01 old\nA" },
    { title: "2026-05-04 mid", date: new Date("2026-05-04T00:00:00Z"), body: "## 2026-05-04 mid\nB" },
    { title: "2026-05-06 new", date: new Date("2026-05-06T00:00:00Z"), body: "## 2026-05-06 new\nC" },
    { title: "学び", date: null, body: "## 学び\nD" },
  ];

  it("threshold 2026-05-04 → 5/1 archives, 5/4+5/6 stay, undated stays", () => {
    const { recent, archive } = partitionByThreshold(sections, new Date("2026-05-04T00:00:00Z"));
    expect(archive.map((s) => s.title)).toEqual(["2026-05-01 old"]);
    expect(recent.map((s) => s.title)).toEqual(["2026-05-04 mid", "2026-05-06 new", "学び"]);
  });

  it("undated section always stays in recent", () => {
    const { recent } = partitionByThreshold(sections, new Date("2030-01-01T00:00:00Z"));
    expect(recent.map((s) => s.title)).toContain("学び");
  });
});

describe("bucketByYearMonth", () => {
  it("groups by YYYY-MM, skips undated", () => {
    const sections = [
      { title: "2026-04-15 a", date: new Date("2026-04-15T00:00:00Z"), body: "x" },
      { title: "2026-04-30 b", date: new Date("2026-04-30T00:00:00Z"), body: "y" },
      { title: "2026-05-01 c", date: new Date("2026-05-01T00:00:00Z"), body: "z" },
      { title: "学び", date: null, body: "w" },
    ];
    const buckets = bucketByYearMonth(sections);
    expect(buckets.get("2026-04")?.map((s) => s.title)).toEqual(["2026-04-15 a", "2026-04-30 b"]);
    expect(buckets.get("2026-05")?.map((s) => s.title)).toEqual(["2026-05-01 c"]);
    expect(buckets.has("undated")).toBe(false);
  });
});

describe("buildArchiveContent", () => {
  it("creates new archive with header when no existing file", () => {
    const sections = [
      { title: "2026-04-01 a", date: new Date("2026-04-01T00:00:00Z"), body: "## 2026-04-01 a\nA\n" },
    ];
    const out = buildArchiveContent(null, sections, "2026-04");
    expect(out).toContain("# operations log archive (2026-04)");
    expect(out).toContain("## 2026-04-01 a");
  });

  it("merges with existing archive, sorts by date, dedupes by title", () => {
    const existing = `# operations log archive (2026-04)

## 2026-04-15 mid
mid content
`;
    const newSections = [
      { title: "2026-04-01 a", date: new Date("2026-04-01T00:00:00Z"), body: "## 2026-04-01 a\nA\n" },
      // 2026-04-15 mid を更新版で上書き
      { title: "2026-04-15 mid", date: new Date("2026-04-15T00:00:00Z"), body: "## 2026-04-15 mid\nUPDATED\n" },
    ];
    const out = buildArchiveContent(existing, newSections, "2026-04");
    // header 維持
    expect(out).toContain("# operations log archive (2026-04)");
    // date 順 (2026-04-01 が 2026-04-15 より先に)
    const idxA = out.indexOf("2026-04-01 a");
    const idxMid = out.indexOf("2026-04-15 mid");
    expect(idxA).toBeLessThan(idxMid);
    // dedupe で UPDATED が残る
    expect(out).toContain("UPDATED");
    expect(out).not.toContain("mid content");
  });
});

describe("buildRecentContent", () => {
  it("rebuilds md with prologue + recent sections", () => {
    const prologue = "# operations log\n\nprologue\n\n";
    const recent = [
      { title: "2026-05-04 mid", date: new Date("2026-05-04T00:00:00Z"), body: "## 2026-05-04 mid\nB" },
      { title: "2026-05-06 new", date: new Date("2026-05-06T00:00:00Z"), body: "## 2026-05-06 new\nC" },
    ];
    const out = buildRecentContent(prologue, recent);
    expect(out.startsWith("# operations log")).toBe(true);
    expect(out).toContain("## 2026-05-04 mid");
    expect(out).toContain("## 2026-05-06 new");
  });

  it("returns just prologue when no recent sections", () => {
    const out = buildRecentContent("# header\n", []);
    expect(out).toBe("# header\n");
  });
});
