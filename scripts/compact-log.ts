/**
 * `operations/log.md` の compact: 古い H2 section を `operations/log.archive.YYYY-MM.md`
 * に移動し、log.md には threshold 内の section のみを残す。
 *
 * 設計思想:
 * - **md は narrative drafting buffer、durable store ではない**。古い entry は BQ
 *   (release_notes 経由) と archive ファイルが durable side。
 * - log.md が context 圧迫しないよう常に小さく保つ。pre-commit hook で行数 cap を強制。
 *
 * pure logic のみ (filesystem 副作用なし)。CLI entry は `compact-log.cli.ts`。
 *
 * @graph-stack core
 * @graph-domain infra
 * @graph-business operations/log.md を時間軸 buffer として運用するための pure logic。H2 で section 分割し、threshold 経過分を年月別 archive に振り分ける。md がコンテキストを圧迫しない設計の心臓部
 * @graph-connects none
 */

/** 1 つの H2 section。 */
export interface LogSection {
  /** H2 title (先頭の `## ` を除く) */
  title: string;
  /** title から parse した日付 (UTC midnight)、parse 失敗時 null */
  date: Date | null;
  /** section 全文 (`## ...\n` ヘッダー + 本文 + 末尾改行) */
  body: string;
}

/**
 * H2 title 先頭の YYYY-MM-DD を Date にする。失敗時 null。
 *
 * @graph-connects none
 */
export function parseSectionDate(title: string): Date | null {
  const m = title.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
}

/**
 * markdown を H2 (`## ...`) で section 分割。先頭 prologue は最初の section の前に
 * 別 buffer で保持される (空 title)。
 *
 * @graph-connects none
 */
export function splitSections(md: string): { prologue: string; sections: LogSection[] } {
  const lines = md.split("\n");
  const sections: LogSection[] = [];
  const prologueLines: string[] = [];
  let currentTitle: string | null = null;
  let currentBody: string[] = [];

  const flush = (): void => {
    if (currentTitle === null) return;
    const body = currentBody.join("\n");
    sections.push({
      title: currentTitle,
      date: parseSectionDate(currentTitle),
      body,
    });
  };

  for (const line of lines) {
    if (line.startsWith("## ")) {
      flush();
      currentTitle = line.slice(3).trim();
      currentBody = [line];
    } else if (currentTitle === null) {
      prologueLines.push(line);
    } else {
      currentBody.push(line);
    }
  }
  flush();

  return {
    prologue: prologueLines.join("\n"),
    sections,
  };
}

/**
 * sections を date threshold で recent / archive に分割。
 * date が null の section (`学び` 等) は常に recent 側 (= 残す)。
 *
 * @graph-connects none
 */
export function partitionByThreshold(
  sections: LogSection[],
  thresholdDate: Date,
): { recent: LogSection[]; archive: LogSection[] } {
  const recent: LogSection[] = [];
  const archive: LogSection[] = [];
  for (const s of sections) {
    if (s.date === null) {
      recent.push(s);
      continue;
    }
    if (s.date.getTime() < thresholdDate.getTime()) {
      archive.push(s);
    } else {
      recent.push(s);
    }
  }
  return { recent, archive };
}

/**
 * archive 行きの sections を YYYY-MM ごとに bucket 化。
 *
 * @graph-connects none
 */
export function bucketByYearMonth(sections: LogSection[]): Map<string, LogSection[]> {
  const out = new Map<string, LogSection[]>();
  for (const s of sections) {
    if (s.date === null) continue;
    const ym = `${s.date.getUTCFullYear()}-${String(s.date.getUTCMonth() + 1).padStart(2, "0")}`;
    const arr = out.get(ym) ?? [];
    arr.push(s);
    out.set(ym, arr);
  }
  return out;
}

/**
 * archive ファイル本文を構築。既存 archive がある場合は section を date 順 merge。
 * 重複 (同 title) は新側で上書き。
 *
 * @graph-connects none
 */
export function buildArchiveContent(
  existingMd: string | null,
  newSections: LogSection[],
  archiveYm: string,
): string {
  const existing = existingMd ? splitSections(existingMd) : { prologue: "", sections: [] };
  const merged = new Map<string, LogSection>();
  for (const s of existing.sections) merged.set(s.title, s);
  for (const s of newSections) merged.set(s.title, s);
  const all = [...merged.values()].sort((a, b) => {
    const da = a.date?.getTime() ?? 0;
    const db = b.date?.getTime() ?? 0;
    return da - db;
  });
  const header = existing.prologue.trim()
    ? existing.prologue
    : `# operations log archive (${archiveYm})\n\n${archiveYm} の古い entry を log.md から自動移送した結果。durable store は BQ (release_notes) 側。\n\n`;
  const body = all.map((s) => s.body).join("\n");
  return header.endsWith("\n") ? header + body : header + "\n" + body;
}

/**
 * recent sections + 元 prologue で log.md を再構築。
 *
 * @graph-connects none
 */
export function buildRecentContent(prologue: string, recent: LogSection[]): string {
  const body = recent.map((s) => s.body).join("\n");
  if (recent.length === 0) return prologue;
  return prologue.endsWith("\n") ? prologue + body : prologue + "\n" + body;
}
