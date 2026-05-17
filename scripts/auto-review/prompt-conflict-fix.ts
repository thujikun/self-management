/**
 * conflict-fix モードで claude -p に渡す prompt を組み立てる pure function。
 *
 * 文脈: PR が `mergeable: CONFLICTING` で `gh pr update-branch` (script-only) で解消できない状態。
 * Claude は conflict 箇所を 3-way merge ロジック判断で解消 → merge commit → push する。
 *
 * fix-job / ci-fix-job との違い:
 *   - review 指摘対応 / CI 修正は不要 (conflict 解消だけが目的)
 *   - 6 gate 全 green まで求めず、minimum `pnpm typecheck` + `pnpm lint` のみ要求
 *     (build / test は時間がかかるしconflict 起因ではない既存 PR の問題まで巻き込むことがある)
 *   - スコープは「conflict marker の解消」+「merge commit を作って push」に限定
 *
 * 出力フォーマット:
 *   - 成功: 普通に commit + push して終了 (stdout に marker 不要)
 *   - 失敗: `<!-- FIX_FAILED:<理由> -->` を 1 行残して終了
 */

export interface ConflictFixPromptInput {
  prNumber: number;
  /** owner/repo 形式 (例: "thujikun/self-management")。 */
  repo: string;
  /** PR branch 名 (例: "feat/auto-review-bot")。 */
  branch: string;
  /**
   * `git merge origin/main` 試行後に conflict marker が残っているか。
   *
   * - `true`: worktree 作成時の auto-merge が失敗し、conflict marker が file に残っている状態 (= AI が解消する必要あり)。
   * - `false`: auto-merge が成功し HEAD に merge commit が積まれている状態 (= poll〜worktree 作成の間に
   *   GH 側で conflict が消えた race。AI は解消不要、push のみ実行する)。
   *
   * 命名上の注意: 内部では worktree.ts の `mergeFailed` flag をそのまま渡すが、AI prompt 側の関心は
   * 「conflict が残っているか」なので意味に沿った名前にしている。
   */
  conflictsRemaining: boolean;
}

export function buildConflictFixPrompt(input: ConflictFixPromptInput): string {
  return input.conflictsRemaining
    ? buildConflictPresentPrompt(input)
    : buildAlreadyMergedPrompt(input);
}

function buildConflictPresentPrompt(input: ConflictFixPromptInput): string {
  return [
    "あなたは self-management リポジトリの開発者です。自分の PR が main branch と conflict していて merge できない状態なので、conflict を解消して push してください。",
    "",
    "# 状況",
    `- repo: ${input.repo}`,
    `- PR: #${input.prNumber}`,
    `- branch: ${input.branch}`,
    "- 現在の cwd は worktree (PR branch checkout 済)",
    "- 既に `git merge origin/main` を試行済 (conflict が発生して merge は中断状態)。`git status` で残った conflict marker を確認できる",
    "- review 対応 / CI 修正は今回 **不要**。conflict 解消だけが目的",
    "",
    "# 作業手順",
    "",
    "1. **conflict 確認**: `git status` で conflicted file 一覧を取得。`git diff --name-only --diff-filter=U` でも可。",
    "   merge は既に進行中 (MERGE_HEAD あり)。各 file を読んで `<<<<<<< HEAD` / `=======` / `>>>>>>> origin/main` を解消する。",
    "",
    "2. **3-way merge 判断**: 各 conflict について以下の観点で解消する。",
    "   - 両方の変更が両立する: マージして両方残す",
    "   - 片方が他方を包含する: 包含側を採用",
    "   - 真っ向対立 (同じ行を別々の意図で変更): PR branch (HEAD) 側の意図を尊重しつつ main 側の意図も汲む",
    "   - lockfile (`pnpm-lock.yaml`) の conflict は `pnpm install` で再生成するのが安全",
    "   - 自動生成ファイル (graph 出力 等) は再生成スクリプトを優先",
    "",
    "3. **解消後 stage**: 各 file に conflict marker が残っていないことを確認してから `git add <file>`。",
    "",
    "4. **merge commit**: `git commit --no-edit` で merge を確定 (commit message は git auto-generated を使う)。",
    "   `--no-edit` を使わずに自前 message を書く必要があれば `chore: resolve conflicts with origin/main` 等の中立 subject にする。",
    "",
    "5. **最小限の sanity check** (高速、conflict 解消の妥当性確認のみ):",
    "```bash",
    "pnpm typecheck",
    "pnpm lint",
    "```",
    "両方 green が望ましいが、conflict 解消で生じた周辺の壊れがある場合は **必要最小限の修正で fix**。",
    "build / test まで全部緑にしようとしてスコープ膨張させない (それは元 PR の責任範囲)。",
    "",
    `6. **push**: \`git push origin ${input.branch}\` で PR branch に push。`,
    "",
    "7. **報告 comment**: `gh pr comment` で簡潔に conflict 解消の報告 (200 文字以内、解消した file と判断要約)。",
    `   コマンド例: \`gh pr comment ${input.prNumber} --repo ${input.repo} --body-file -\` に stdin で本文を流す。`,
    "",
    "# 絶対遵守ルール (CLAUDE.md)",
    "",
    "- pre-commit hook を **絶対に bypass しない** (`--no-verify` 等は使わない)",
    "- lint / type-check / format の suppression directive を **絶対に追加しない** (CLAUDE.md ルール 2)。型 / lint 違反は構造で解く",
    "- 自動化されていることに言及しない",
    "",
    "# 失敗時の挙動",
    "",
    "- 意味的判断ができない conflict (両方の意図を理解できない / 真っ向対立で判断できない) や、解消後の typecheck/lint が green にできない場合、push せず終了。stdout に `<!-- FIX_FAILED:<理由> -->` を 1 行残す。呼び出し側 (conflict-fix-job.ts) は当該 SHA の `conflictFixFailureCount` を +1 し、同 SHA は最大 3 回まで backoff 付き retry。3 回到達後は新 commit が来るまで skip される。安易に early-give-up しないこと、限界まで try してから FIX_FAILED を出すこと。",
  ].join("\n");
}

function buildAlreadyMergedPrompt(input: ConflictFixPromptInput): string {
  return [
    "あなたは self-management リポジトリの開発者です。あなたの PR は GH 側では conflict 扱いでしたが、worktree 作成時の `git merge origin/main` が **成功** しました (poll〜worktree 作成の間に conflict が解消された race)。あとは merge commit を push するだけで GH 上の CONFLICTING も解消されます。",
    "",
    "# 状況",
    `- repo: ${input.repo}`,
    `- PR: #${input.prNumber}`,
    `- branch: ${input.branch}`,
    "- 現在の cwd は worktree (PR branch checkout 済、`origin/main` の merge commit が HEAD に既に乗っている)",
    "- conflict marker は **無い**。再度 `git merge origin/main` を叩いても `Already up to date` になるだけ",
    "- review 対応 / CI 修正は今回 **不要**。push して GH に反映するだけが目的",
    "",
    "# 作業手順",
    "",
    "1. **状態確認**: `git status` で worktree clean を確認、`git log -1 --pretty=fuller` で HEAD が merge commit になっていることを確認する。",
    "   - もし `MERGE_HEAD` が残っている / `git status` で unmerged file が見つかる場合、想定外の状態なので `<!-- FIX_FAILED:unexpected merge state -->` を残して終了。",
    "",
    `2. **push**: \`git push origin ${input.branch}\` で PR branch に push。これだけで GH 上の \`mergeable: CONFLICTING\` は自動で解消され、次の poll tick で reviewer / merge が再評価する。`,
    "   - 既に上流が同 SHA に進んでいる場合 (`Everything up-to-date`) は push 不要扱いで OK。呼び出し側の push 検証は origin/branch SHA を別途確認するので、ここで `<!-- FIX_FAILED -->` は出さない。",
    "",
    "3. **報告 comment**: `gh pr comment` で簡潔に「auto-merge succeeded, pushed merge commit」の報告 (100 文字以内)。",
    `   コマンド例: \`gh pr comment ${input.prNumber} --repo ${input.repo} --body-file -\` に stdin で本文を流す。`,
    "",
    "# 絶対遵守ルール (CLAUDE.md)",
    "",
    "- pre-commit hook を **絶対に bypass しない** (`--no-verify` 等は使わない)",
    "- lint / type-check / format の suppression directive を **絶対に追加しない** (CLAUDE.md ルール 2)。型 / lint 違反は構造で解く",
    "- 自動化されていることに言及しない",
    "",
    "# 失敗時の挙動",
    "",
    "- push が auth / network / branch protection 等で失敗した場合、stdout に `<!-- FIX_FAILED:<理由> -->` を 1 行残して終了。呼び出し側 (conflict-fix-job.ts) は当該 SHA の `conflictFixFailureCount` を +1 し、同 SHA は最大 3 回まで backoff 付き retry。3 回到達後は新 commit が来るまで skip される。",
  ].join("\n");
}
