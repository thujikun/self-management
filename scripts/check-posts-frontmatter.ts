/*
 * check-posts-frontmatter logic — content/posts/*.{ja,en}.md の frontmatter を
 * `@self/content` の `parseFrontmatter` (= site build / syndicate が使う SoT schema)
 * で検証し、違反 post を列挙する pure 層。
 *
 * Why: rendered-posts vite plugin が build 時に全 post を parseFrontmatter するため、
 * `devto.id: TBD` のような schema 違反 1 件で site build / deploy 全体が落ちる。
 * しかも turbo build cache が submodule content を input hash に含めないため、
 * submodule pointer bump 時に `gate (build)` が cache hit して frontmatter を再検証
 * せず、deploy (fresh build) で初めて落ちる事故が起きた (2026-05-24)。
 *
 * 本 gate は post file を毎回直接 parse する (cache 非依存) ので、bump PR の CI で
 * malformed frontmatter を確実に弾き、deploy が壊れた pointer を main に通さない。
 *
 * 設計 (check-covers-exist と同じ): pure logic は本ファイル (parse は引数注入)、
 * filesystem I/O / process.exit / stdout の glue は `check-posts-frontmatter.cli.ts`。
 *
 * @graph-stack core
 * @graph-domain infra
 * @graph-business posts-frontmatter gate の pure 層。post の frontmatter data 配列と parse 述語を受け取り、parseFrontmatter が throw した post を file:message で列挙する。turbo build cache を迂回して submodule content の schema 違反を bump PR CI で弾く
 * @graph-connects none
 */

/** 検証対象 1 件。`file` は表示用 path、`data` は gray-matter が抽出した frontmatter object。 */
export interface PostFrontmatter {
  file: string;
  data: unknown;
}

/** 違反 1 件。CLI が stderr に出して exit 1 する。 */
export interface FrontmatterViolation {
  file: string;
  message: string;
}

/**
 * `posts` の各 frontmatter を `parse` で検証し、throw した post を violation として返す。
 * `parse` は CLI 側が `@self/content` の `parseFrontmatter` を渡す (= build / syndicate
 * と同一 schema)。logic は I/O に触れない pure 関数。
 *
 * @graph-connects none
 */
export function collectFrontmatterViolations(
  posts: ReadonlyArray<PostFrontmatter>,
  parse: (data: unknown) => void,
): FrontmatterViolation[] {
  const violations: FrontmatterViolation[] = [];
  for (const p of posts) {
    try {
      parse(p.data);
    } catch (err) {
      violations.push({ file: p.file, message: formatParseError(err) });
    }
  }
  return violations;
}

/**
 * parse 例外を 1 行に整形する。Zod の `issues` 配列があれば `path: message` を `;` 連結、
 * 無ければ `Error.message` を使う。
 *
 * @graph-connects none
 */
export function formatParseError(err: unknown): string {
  const issues = (err as { issues?: ReadonlyArray<{ path?: unknown[]; message?: string }> })
    ?.issues;
  if (Array.isArray(issues) && issues.length > 0) {
    return issues
      .map((i) => {
        const path = Array.isArray(i.path) && i.path.length > 0 ? i.path.join(".") : "(root)";
        return `${path}: ${i.message ?? "invalid"}`;
      })
      .join("; ");
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
