/**
 * ci-fix モードで claude -p に渡す prompt を組み立てる pure function。
 *
 * 文脈: bot 自身の APPROVE comment が posting 済 + CI に failed job がある状態。
 * Claude は失敗 job log を取得して根本原因を診断 → 修正 → commit & push。
 *
 * ローカルでの 6 gate 一括実行は agent 側ではやらない方針 (prompt-fix.ts と同じ):
 * - pre-commit hook が staged file 単位の gate (lint / format / coverage-staged /
 *   secrets / no-ignore / line-count / graph-tags / log-check) を強制実行する
 * - typecheck / full build / full test は push 後の CI が pre-merge で踏む
 * - 失敗が直らなければ ci-fix-job が同 SHA を最大 3 回 retry (`ciFixFailureCount` cap)
 *
 * ただし「CI が落ちている特定の gate」だけは agent が手元で再現 / 検証してから
 * push したい場面が多いので、Step 4 で **そこだけ focused に走らせる** よう促す
 * (= `pnpm test:coverage` で全 test を再走するのではなく、failing test だけ
 * `vitest run <file>` で個別検証)。
 *
 * 出力フォーマットは prompt-fix.ts と同じく:
 *   - 成功: 普通に commit + push して終了 (stdout に marker 不要)
 *   - 失敗: `<!-- FIX_FAILED:<理由> -->` を 1 行残して終了
 */

export interface CiFixPromptInput {
  prNumber: number;
  /** owner/repo 形式 (例: "thujikun/self-management")。 */
  repo: string;
  /** PR branch 名 (例: "feat/auto-review-bot")。 */
  branch: string;
  /** 失敗中の CI check 名と関連 run id の一覧 (poll 側で取得して渡す)。 */
  failingChecks: ReadonlyArray<{ name: string; runId: string; jobUrl: string }>;
}

export function buildCiFixPrompt(input: CiFixPromptInput): string {
  const failingList = input.failingChecks
    .map((c, i) => `${i + 1}. **${c.name}** (run_id=${c.runId})\n   - job URL: ${c.jobUrl}`)
    .join("\n");
  return [
    "あなたは self-management リポジトリの開発者です。自分の PR は code review で APPROVE 済ですが、CI が失敗していて merge できません。CI の failing job を修正して push してください。",
    "",
    "# 状況",
    `- repo: ${input.repo}`,
    `- PR: #${input.prNumber}`,
    `- branch: ${input.branch}`,
    "- 現在の cwd は worktree (PR branch checkout 済、origin/main は merge 試行済)",
    `- bot の review verdict は **APPROVE** で、コード品質は通っている。今回 fix すべきは **CI 失敗の根本原因**`,
    "",
    "# 失敗中の CI check",
    "",
    failingList,
    "",
    "# 作業手順",
    "",
    "1. **失敗 log を取得**: 各 failing check について以下で log の末尾を読む。",
    "   ```bash",
    `   gh run view <run_id> --repo ${input.repo} --log-failed | tail -200`,
    "   ```",
    "   ANSI escape や noise が混じることがあるので、error / fail / Error 等で grep して根本原因を絞る:",
    "   ```bash",
    `   gh run view <run_id> --repo ${input.repo} --log-failed | grep -iE 'error|fail' | tail -50`,
    "   ```",
    "",
    "2. **根本原因を診断**: log から失敗の本当の理由を読み解く。examples:",
    "   - typecheck error → 該当 file:line を fix",
    "   - test fail → 該当 test を読んで実装を fix (test を緩めない、`testing.md` 違反禁止)",
    "   - lint error → 該当箇所を fix (suppression directive で黙らせるのは CLAUDE.md 違反、構造で解く)",
    "   - infra (pulumi / cf) error → config / 環境変数 / IAM 設定の問題 → 該当 file を fix",
    "   - 一過性 (flaky test, ネットワーク等) で本コードに問題なしと判断したら **FIX_FAILED**",
    "",
    "3. **修正**:",
    "   - 修正対象は **CI 失敗の原因箇所のみ**。スコープ拡大しない",
    "   - 不可解な失敗で AI 判断では分からない場合は無理に「とりあえず修正」しない。診断結果を FIX_FAILED で報告し人間に委ねる",
    "",
    "4. **failing gate を focused に検証** (= ローカル 6 gate を全部回すのは禁止、時間の浪費):",
    "   - CI が落ちた gate **だけ** を repo root で個別実行して直ったことを確認する",
    "   - test fail なら failing test path だけ vitest に渡す (例: `pnpm exec vitest run apps/foo/src/bar.test.ts`)、`pnpm test:coverage` での全 test 再走は不要",
    "   - typecheck fail なら該当 workspace の `pnpm --filter <workspace> typecheck`、root 全体は不要",
    "   - lint fail なら `pnpm lint <file>` or `pnpm lint --fix <file>` で focused 修正",
    "   - infra (pulumi / cf) 失敗は `infra/core` / `infra/ryantsuji-dev` のディレクトリでローカル `pulumi preview` を回せるなら回す。secret 不足など bot ローカルで再現不可能なら FIX_FAILED 妥当",
    "",
    "5. **commit**: Conventional Commits 形式 (`fix:` / `chore:` / `refactor:` 等、type 小文字 / subject 末尾ピリオドなし)。",
    `   ヘッダーは 100 字以内。本文に「pr #${input.prNumber} ci fix」と書き、修正内容を箇条書きで残す。`,
    "   commit 時に pre-commit hook が staged file 単位の gate を強制実行する。`--no-verify` で bypass しない。残りの typecheck / 全 test / build は次の CI run が pre-merge で踏むので agent 側で全部回す必要はない。",
    "",
    `6. **push**: \`git push origin ${input.branch}\` で PR branch に push。CI が再度落ちた場合 ci-fix-job が同 SHA を最大 3 回 retry する (cap で必ず止まる)。`,
    "",
    "7. **報告 comment**: `gh pr comment` で簡潔に CI 修正の対応報告 (200 文字以内、各 failing check の原因と対処を要約)。",
    `   コマンド例: \`gh pr comment ${input.prNumber} --repo ${input.repo} --body-file -\` に stdin で本文を流す。`,
    "",
    "# 絶対遵守ルール (CLAUDE.md)",
    "",
    "- pre-commit hook を **絶対に bypass しない** (`--no-verify` 等は使わない)",
    "- lint / type-check / format の suppression directive を **絶対に追加しない** (CLAUDE.md ルール 2)。型 / lint 違反は構造で解く",
    "- coverage threshold (per-file 90%) を **下げない**。閾値違反はテストを足す or 構造で解く",
    "- test を弱める形での修正 (assertion 緩和 / skip / mock 拡大) は禁止。test が CI を落としているなら test が正しい",
    "- 自動化されていることに言及しない",
    "",
    "# 失敗時の挙動",
    "",
    "- 診断はしたが AI 判断では fix できない / 失敗が一過性で repo の変更で直らない / focused 検証で gate が green にできない場合、push せず終了。stdout に `<!-- FIX_FAILED:<理由> -->` を 1 行残す。呼び出し側 (ci-fix-job.ts) は当該 SHA の `ciFixFailureCount` を +1 し、同 SHA は最大 3 回まで backoff 付き retry。3 回到達後は新 commit が来るまで skip される。安易に early-give-up しないこと、限界まで try してから FIX_FAILED を出すこと。",
  ].join("\n");
}
