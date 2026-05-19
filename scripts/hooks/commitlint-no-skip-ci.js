/**
 * commitlint plugin: GitHub Actions の skip-ci magic string が commit message
 * (subject / body 含む raw 全体) に literal で混入していないかを検査する。
 *
 * GitHub は subject / body 問わず以下の文字列を見つけたら on: push / pull_request
 * 系 workflow を **silently skip** する。skip された run は Actions UI にも残らず、
 * 「merge したのに deploy が走らない」状態が黙って発生する事故源になる。
 * https://docs.github.com/en/actions/managing-workflow-runs/skipping-workflow-runs
 *
 * 設計上の人間入力としての skip-ci 自体は禁止しない (= 意図して付ける時はそのまま
 * 通す) が、本 repo の運用方針として「commit 単位で workflow を skip させない」を
 * 取るため、混入はすべて error にする。説明文として skip-ci を綴りたい時は
 * 非破壊空白 ("[skip\\u00A0ci]") か分割表記 ("[skip" + " ci]") に逃がす。
 *
 * commitlint plugin 形式: 関数 `(parsed) => [pass, message?]` を `rules` map に置く。
 * `parsed.raw` は subject + body を含む元 message 全文 (commitlint が parser 通す前)。
 *
 * テスト容易性のため `checkNoSkipCi` を named export し、plugin object は
 * `default` export で commitlint.config.js から `plugins` に直接渡せる形にする。
 *
 * @type {import('@commitlint/types').Plugin}
 */

/**
 * GitHub Actions が認識する skip-ci magic string (大小無視)。
 * 公式 docs に列挙されている 5 種類すべてを対象に。
 *
 * @type {ReadonlyArray<RegExp>}
 */
export const SKIP_CI_PATTERNS = Object.freeze([
  /\[skip ci\]/i,
  /\[ci skip\]/i,
  /\[no ci\]/i,
  /\[skip actions\]/i,
  /\[actions skip\]/i,
]);

/**
 * @param {{ raw?: string | null | undefined }} parsed
 * @returns {[boolean, string?]}
 */
export function checkNoSkipCi(parsed) {
  const raw = parsed?.raw ?? "";
  for (const re of SKIP_CI_PATTERNS) {
    if (re.test(raw)) {
      const display = re.source.replace(/\\/g, "");
      return [
        false,
        `commit message contains "${display}" which is a GitHub Actions skip-ci magic string. ` +
          `Even inside backticks or quotes, GitHub matches the literal characters and silently skips ` +
          `all on: push / pull_request workflows for this commit (no run row in the Actions UI). ` +
          `To discuss this token in prose, escape with a non-breaking space ("[skip\\u00A0ci]") ` +
          `or split the chars ("[skip" + " ci]").`,
      ];
    }
  }
  return [true];
}

/** @type {import('@commitlint/types').Plugin} */
const plugin = {
  rules: {
    "no-skip-ci-magic": checkNoSkipCi,
  },
};

export default plugin;
