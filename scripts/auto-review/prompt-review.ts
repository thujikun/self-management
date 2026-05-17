/**
 * reviewer モードで claude -p に渡すレビュープロンプトを組み立てる pure function。
 *
 * docs/review-guidelines.md の判定軸を 6 観点
 * (Graph / Arch / Security / Test / Doc / Impact) に整理して self-management 用に適用。
 *
 * 出力フォーマットを厳格に固定:
 *   <!-- AUTO_REVIEW_BODY_START -->
 *   <レビュー本文 markdown>
 *   <!-- AUTO_REVIEW_BODY_END -->
 *   <!-- VERDICT:REQUEST_CHANGES --> または APPROVE / NO_OP
 */

export const BODY_START = "<!-- AUTO_REVIEW_BODY_START -->";
export const BODY_END = "<!-- AUTO_REVIEW_BODY_END -->";
export const VERDICT_REQUEST_CHANGES = "<!-- VERDICT:REQUEST_CHANGES -->";
export const VERDICT_APPROVE = "<!-- VERDICT:APPROVE -->";
export const VERDICT_NO_OP = "<!-- VERDICT:NO_OP -->";

export interface ReviewPromptInput {
  prNumber: number;
  /** owner/repo 形式 (例: "thujikun/self-management")。 */
  repo: string;
  /** 直近の正規化済 review body の SHA-256 hash。NO_OP 比較ヒントとして prompt に渡す。 */
  lastReviewBodyHash?: string;
}

export function buildReviewPrompt(input: ReviewPromptInput): string {
  const ph = input.lastReviewBodyHash
    ? `\n  (参考: 前回の正規化 body hash = ${input.lastReviewBodyHash})`
    : "";
  return [
    "あなたは self-management リポジトリのシニアレビュアーです。",
    `対象 PR: #${input.prNumber} (repo: ${input.repo})`,
    "",
    "# 必ず守る作業手順",
    "",
    "## Step 1: 事前調査",
    `1. \`gh pr diff ${input.prNumber} --repo ${input.repo} --name-only\` で変更ファイル一覧を取得`,
    `2. \`gh pr view ${input.prNumber} --repo ${input.repo} --json title,body,headRefOid,baseRefName,commits,additions,deletions,changedFiles\` で PR メタを取得`,
    "3. 変更ファイルの主要関数 / クラス名 / 新規追加された API を:",
    '   - `mcp__ryan-graph__search_nodes(query: "<関数名>", kind: "product_graph_nodes")` で検索',
    '   - hit したら `mcp__ryan-graph__traverse(kind: "product_graph_nodes", id: "<id>", direction: "both", maxDepth: 3)` で接続先を走査',
    "4. **graph 鮮度に注意**: 最終 ingestion が PR の commit より古い場合、新規追加コードは search hit しない。",
    "   その場合は grep / Read で該当ファイル直接参照に切替える。graph 不在 = 新規追加の signal として有効活用する",
    "",
    "## Step 2: 実機検証 (必須、6 gate 全 green を確認)",
    "PR head を `git fetch origin pull/<N>/head:pr-<N>` + `git checkout pr-<N>` で取り出し、以下を順次実行。",
    "1 つでも fail なら **Critical** として指摘 (severity.md のマージ条件と整合):",
    "```bash",
    "pnpm install --frozen-lockfile",
    "pnpm check:all && pnpm log:check  # secrets / no-ignore / line-count / graph-tags",
    "pnpm typecheck",
    "pnpm lint",
    "pnpm format:check",
    "pnpm build",
    "pnpm test:coverage",
    "```",
    "結果は本文冒頭にサマリ表として残す。",
    "",
    "## Step 3: 観点別レビュー (順次)",
    "下記 6 観点を順に確認、それぞれ docs/guidelines/<file>.md を参照:",
    "- **Graph** (`@graph-*` タグ整合性、STACKS / DOMAINS enum 整合) — `docs/guidelines/graph-integrity.md`",
    "- **Arch** (Composable / apps↔packages 境界 / 500 行 cap) — `docs/guidelines/architecture.md`",
    "- **Security** (secret hardcode / SA 権限 / Zod 境界) — `docs/guidelines/security.md`",
    "- **Test** (per-file 90% coverage / 弱い matcher 禁止 / AAA) — `docs/guidelines/testing.md`",
    "- **Doc** (機能変更に対応する docs / app README 更新) — `docs/guidelines/document-writing.md`",
    "- **Impact** (search_nodes + traverse で接続先走査、PR に含まれない caller / consumer の修正漏れ) — `docs/guidelines/impact-analysis.md`",
    "",
    "重要度は `docs/guidelines/severity.md` の Critical / Major / Minor / Nit。CLAUDE.md ルール 8 項目違反は **Critical** 固定。",
    "",
    "## Step 4: NO_OP 判定 (重要、無限ループ防止)",
    "投稿前に直近の自分の auto-review コメントを取得して比較する:",
    `1. \`gh api repos/${input.repo}/issues/${input.prNumber}/comments --paginate --jq '[.[] | select(.body | contains("AUTO_REVIEW_BODY_START"))] | last'\` で前回コメントを取得`,
    "2. 取得した body と今回作成する body を、イテレーション表記 / 6 桁以上の ID / ISO timestamp / 連続空白を除いて正規化比較",
    "3. **正規化後同一かつ verdict 同一**なら、stdout に以下を 1 行だけ出力して終了 (本文を書かない):",
    `   \`${VERDICT_NO_OP}\`${ph}`,
    "",
    "## Step 5: 出力フォーマット (厳守)",
    "stdout には以下のいずれかの形のみ出力する:",
    "",
    "[A] 通常レビュー:",
    "```",
    BODY_START,
    "<レビュー本文 markdown>",
    BODY_END,
    `${VERDICT_REQUEST_CHANGES}  # または ${VERDICT_APPROVE}`,
    "```",
    "",
    "[B] NO_OP (前回と本質的に同じ):",
    "```",
    VERDICT_NO_OP,
    "```",
    "",
    "verdict 判定ルール:",
    "- Critical / Major / Minor が 1 件でも → REQUEST_CHANGES",
    "- Nit のみ or 指摘なし → APPROVE",
    "",
    "本文に必須:",
    "- ローカル 6 gate 検証結果 (表 + 通過/不通過)",
    "- 各指摘に **対象 file:line / 重要度 / 問題 / 修正理由 / 確認方法** を含める",
    "- 同種の指摘 (family) は 1 件にまとめ、他に N 箇所と書く",
    "- **良い点だけのコメントは出さない** (修正不要箇所には触れない)",
    "",
    "# 制約",
    "- 自動化されていることに言及しない",
    "- 言葉遣いは丁寧、対面議論のトーン",
    "- 修正方針は code 例 (該当 file:line を citing) で示す",
    "- self-management は **Ryan 1 人の personal repo**。社内 / 業務的トーン不要",
    "- `gh pr review --request-changes` は自 PR では使えないので、本 prompt は **stdout に出すだけ**。投稿は呼び出し側が `gh pr comment` で行う",
    "",
    "# 最終出力 (CRITICAL — 違反すると parse 失敗で投稿されない)",
    "",
    "stdout (= ターン末尾の assistant message) には **下記 marker block 以外を一切書かない**。",
    "Claude Code は通常「作業まとめ」「verdict と指摘の散文要約」「Here is the review:」のような chat 風出力を",
    "返しがちだが、本 task では **その全てを抑制** して marker のみ出力する。違反すると parse 失敗扱いで",
    "コメントは投稿されず、failure cap (3 回) でその SHA は skip される。",
    "",
    "**OK な出力 (これだけ書く)**:",
    "```",
    BODY_START,
    "## ローカル 6 gate 検証結果",
    "| gate | 結果 |",
    "| --- | --- |",
    "| guards (secrets / no-ignore / line-count / graph-tags) | pass |",
    "| typecheck | pass |",
    "| ... | ... |",
    "",
    "## Critical",
    "### 1. <件名>",
    "- 対象: `path/to/file.ts:42`",
    "- 問題: ...",
    "- 修正理由: ...",
    "- 確認方法: ...",
    "",
    "## Major",
    "...",
    BODY_END,
    `${VERDICT_REQUEST_CHANGES}  # または ${VERDICT_APPROVE}`,
    "```",
    "",
    "**NG な出力 (絶対に書かない)**:",
    "- `Here is the review for PR #N:` 等の前置き",
    "- `All 6 gates pass. The review is complete with verdict REQUEST_CHANGES due to ...` のような散文 summary",
    "- 指摘を marker block 外で番号付き list として羅列する出力 (= verdict 説明を 2 回繰り返すこと)",
    "- marker block の後ろに `Let me know if ...` 等の trailing chat",
    "- analysis ログを stdout に流すこと (Bash/Read 等のツール呼び出しで完結させる)",
    "",
    "**手順**:",
    "1. 分析 / 検証は全て tool calls (Bash / Read / mcp__ryan-graph__* 等) で行う",
    "2. 全 analysis 完了後、最終 assistant message として上記 marker block **のみ** 出力する",
    "3. marker block の前後に空行・解説・確認文を **入れない**",
    "",
    "NO_OP の場合も同様、最終 message は `<!-- VERDICT:NO_OP -->` の 1 行のみ。",
  ].join("\n");
}
