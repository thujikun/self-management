/**
 * 予約投稿 (scheduled publish) の中核ロジック。
 *
 * 「`draft: true` && `publishedAt <= now`」の post の frontmatter から `draft:` 行を
 * 物理的に削除する pure 関数群。actual file I/O + git commit + push は呼び出し側
 * (`schedule-publish.cli.ts` + workflow yaml) が担当する。
 *
 * **publishedAt 形式の対応**:
 * - date-only (`"2026-05-19"`) — `new Date()` が UTC 00:00 として解釈
 * - datetime + TZ offset (`"2026-05-19T09:00:00+09:00"`) — 完全 ISO 8601
 *   両方とも `new Date()` がそのまま受理する。比較は epoch ms ベースなので TZ も保持
 *
 * **draft 行削除のスコープ**:
 * frontmatter ブロック (`---` で囲まれた先頭領域) 内の `draft: true` 行のみ削除。
 * 本文中に偶然 `draft: true` という文字列があっても影響しないように regex を
 * frontmatter substring 内に閉じ込める。`draft: false` は削除対象外 (既に published
 * 扱いなので no-op が正)。
 *
 * **改行保持**:
 * frontmatter の他行・本文・末尾改行を破壊しない。`draft:` 行が消えた後の YAML が
 * valid なまま残る (= 周辺行に独自処理を入れない)。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business 予約投稿の判定 + frontmatter 書き換えの pure 関数群。`publishedAt` が現在時刻以下になった draft post を検出して `draft: true` 行を strip した markdown を返す。datetime (TZ offset) も date-only も両対応で、cron で 15 分間隔に走る scheduler が呼ぶ
 * @graph-connects none
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * post 1 本に対する 1 回の判定結果。`changed: true` なら呼び出し側で file を上書きする。
 *
 * @graph-connects none
 */
export interface ScheduleEvaluation {
  filename: string;
  slug: string;
  publishedAt: string;
  changed: boolean;
  newContent?: string;
}

/**
 * `publishedAt` の文字列が「now 時点で公開すべき」値か判定。
 * date-only は UTC 00:00 として、datetime + offset は完全 ISO 8601 として比較。
 *
 * 不正な文字列 (parse 不能) は `false` を返す (= 公開しない、安全側)。
 *
 * @graph-connects none
 */
export function shouldPublish(publishedAt: string, now: Date): boolean {
  const target = new Date(publishedAt);
  if (Number.isNaN(target.getTime())) return false;
  return target.getTime() <= now.getTime();
}

/**
 * frontmatter ブロック内の `draft: true` 行を 1 行削除した markdown を返す。
 * frontmatter (= 先頭の `---\n...\n---\n`) が無ければ no-op。
 * `draft: true` が無ければ no-op (= 既に published 扱い)。
 *
 * 削除は **行単位** で行う (前後改行も含めて 1 行分消す)。
 *
 * @graph-connects none
 */
export function stripDraftLine(markdown: string): string {
  const fmMatch = markdown.match(/^(---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/u);
  if (!fmMatch) return markdown;
  const [whole, openDelim, body, closeDelim] = fmMatch as unknown as [
    string,
    string,
    string,
    string,
  ];
  const lines = body.split(/\r?\n/u);
  const filtered = lines.filter((line) => !/^draft:\s*true\s*$/u.test(line));
  if (filtered.length === lines.length) return markdown;
  const rebuilt = `${openDelim}${filtered.join("\n")}${closeDelim}`;
  return markdown.replace(whole, rebuilt);
}

/**
 * frontmatter から `publishedAt: "..."` / `draft: true` を**正規表現で**ピックアップ
 * する軽量 parser。CLI 層では YAML 全体を parse する必要はない (今回必要なのは
 * 2 field だけ) ので、依存を追加せず regex で十分。複雑な YAML 形式 (multiline
 * scalar / anchor 等) を `publishedAt` / `draft` には使わない前提。
 *
 * **対応する `publishedAt` 値の domain**:
 * ASCII scalar (date-only / ISO 8601 datetime + TZ offset) のみ。value 内部に
 * `'` / `"` を含むケースは想定外で、`pubMatch` の regex が成立せず `publishedAt:
 * null` が返る (= 公開判定は false 側に倒れる = 安全側)。本 scheduler は ISO 8601
 * 形式の `publishedAt` しか consume しないので実害は無いが、本関数を他 frontmatter
 * field の汎用 reader として流用するのは不可。
 *
 * @graph-connects none
 */
export function extractMeta(markdown: string): { publishedAt: string | null; draft: boolean } {
  const fmMatch = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
  if (!fmMatch) return { publishedAt: null, draft: false };
  const fm = (fmMatch as unknown as [string, string])[1];
  const pubMatch = fm.match(/^publishedAt:\s*["']?([^"'\n\r]+)["']?\s*$/mu);
  const draftMatch = fm.match(/^draft:\s*true\s*$/mu);
  return {
    publishedAt: pubMatch ? ((pubMatch as unknown as [string, string])[1] ?? null) : null,
    draft: draftMatch !== null,
  };
}

/**
 * filename (`<slug>.<lang>.md`) から slug を抽出。マッチしない場合は filename 全体。
 *
 * @graph-connects none
 */
export function slugOfFilename(filename: string): string {
  const m = filename.match(/^(.+)\.(en|ja)\.md$/u);
  return m ? ((m as unknown as [string, string])[1] ?? filename) : filename;
}

/**
 * 1 本の markdown を判定し、必要なら `draft:` を strip した新 content を返す。
 * draft でない / publishedAt 未来 / publishedAt 不正 のいずれかなら `changed: false`。
 *
 * @graph-connects none
 */
export function evaluatePost(filename: string, markdown: string, now: Date): ScheduleEvaluation {
  const meta = extractMeta(markdown);
  const slug = slugOfFilename(filename);
  const base: Omit<ScheduleEvaluation, "changed" | "newContent"> = {
    filename,
    slug,
    publishedAt: meta.publishedAt ?? "",
  };
  // `_` prefix slug は test fixture (e.g. `_draft-example`)。draft 保持が前提なので
  // scheduler が拾って flip しないように常に skip する (listing 側も同 prefix で除外)。
  if (slug.startsWith("_")) return { ...base, changed: false };
  if (!meta.draft) return { ...base, changed: false };
  if (!meta.publishedAt) return { ...base, changed: false };
  if (!shouldPublish(meta.publishedAt, now)) return { ...base, changed: false };
  const newContent = stripDraftLine(markdown);
  if (newContent === markdown) return { ...base, changed: false };
  return { ...base, changed: true, newContent };
}

/**
 * `dir` 配下の `*.md` を全部読んで evaluatePost を回す I/O 層。
 * 戻り値の中の `changed: true` の post を呼び出し側が書き出す。
 *
 * @graph-connects none
 */
export async function evaluateDirectory(dir: string, now: Date): Promise<ScheduleEvaluation[]> {
  const entries = await readdir(dir);
  const mdFiles = entries.filter((f) => f.endsWith(".md"));
  const evaluations: ScheduleEvaluation[] = [];
  for (const filename of mdFiles) {
    const fullPath = join(dir, filename);
    const content = await readFile(fullPath, "utf8");
    evaluations.push(evaluatePost(filename, content, now));
  }
  return evaluations;
}
