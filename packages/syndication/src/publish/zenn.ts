/**
 * Zenn publish 層。`thujikun/ryantsuji-dev-content` repo に commit & push する。
 *
 * Zenn GitHub sync が監視するのは `articles/<id>.md` (Zenn article id 単位)。本 module
 * は markdown を該 path に書き込み、git で commit & push する形を取る。実 git
 * 操作は child_process 経由 (simple-git 等の library 依存を避ける、純粋に shell)。
 *
 * `dryRun` で実 push を skip し、書き込み + log のみに留める。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business Zenn GitHub sync repo (ryantsuji-dev-content) に articles/<id>.md を書き出し、git commit & push する I/O 層。local clone path を引数で受け、未 clone なら git clone から行う。dry-run と通常 push の 2 mode、commit message は自動生成
 * @graph-connects none
 */

import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";

/** @graph-connects none */
export interface PublishZennArgs {
  /** local clone path。例: `~/Workspace/ryantsuji-dev-content` */
  repoDir: string;
  /** clone 元 (未 clone 時に使用)。例: `git@github.com:thujikun/ryantsuji-dev-content.git` */
  remoteUrl: string;
  /** Zenn article id (= ファイル名)。例: `d9fc317c1336c2` */
  zennId: string;
  /** 完成 markdown (frontmatter + body + footer まで含む) */
  markdown: string;
  /** commit subject。default: `chore: sync articles/<id>.md` */
  commitSubject?: string;
  /** dryRun: true で write までだけ、commit/push 無し */
  dryRun?: boolean;
}

/** @graph-connects none */
export interface PublishZennResult {
  filePath: string;
  /** 実 commit 時の sha。dry-run / no-change の時は null */
  commitSha: string | null;
  pushed: boolean;
}

/**
 * Zenn repo に article を書き込み、変更があれば commit + push する。
 *
 * @graph-connects none
 */
export async function publishToZenn(args: PublishZennArgs): Promise<PublishZennResult> {
  if (!existsSync(args.repoDir)) {
    await runGit(["clone", args.remoteUrl, args.repoDir], process.cwd());
  }
  // articles/ ディレクトリを確保
  const articlesDir = resolve(args.repoDir, "articles");
  await mkdir(articlesDir, { recursive: true });

  const filePath = resolve(articlesDir, `${args.zennId}.md`);
  // 既存内容と一致するなら write しない (mtime 不変、no-op)
  let unchanged = false;
  if (existsSync(filePath)) {
    const prev = await readFile(filePath, "utf8");
    unchanged = prev === args.markdown;
  }
  if (!unchanged) {
    await writeFile(filePath, args.markdown, "utf8");
  }

  if (args.dryRun) {
    return { filePath, commitSha: null, pushed: false };
  }
  if (unchanged) {
    return { filePath, commitSha: null, pushed: false };
  }

  await runGit(["add", `articles/${args.zennId}.md`], args.repoDir);
  // staged diff が空なら commit skip (no-op safety)
  const staged = await runGit(["diff", "--cached", "--quiet"], args.repoDir, { allowFail: true });
  if (staged === 0) {
    return { filePath, commitSha: null, pushed: false };
  }
  const subject = args.commitSubject ?? `chore: sync articles/${args.zennId}.md`;
  await runGit(["commit", "-m", subject], args.repoDir);
  const sha = (await runGitOutput(["rev-parse", "HEAD"], args.repoDir)).trim();
  await runGit(["push"], args.repoDir);
  return { filePath, commitSha: sha, pushed: true };
}

/** @graph-connects none */
export interface CleanupOrphanZennArticlesArgs {
  /** Zenn repo の local clone path。 */
  repoDir: string;
  /** clone 元 (未 clone 時に使用)。 */
  remoteUrl: string;
  /** 削除対象の Zenn article id リスト (= `articles/<id>.md` のファイル名)。 */
  zombieIds: string[];
  /** commit subject。default: `chore: cleanup orphan Zenn articles (N)`。 */
  commitSubject?: string;
  /** dryRun: true で unlink までだけ、commit/push 無し。 */
  dryRun?: boolean;
}

/** @graph-connects none */
export interface CleanupOrphanZennArticlesResult {
  deletedFiles: string[];
  /** 実 commit 時の sha。dry-run / no-change の時は null */
  commitSha: string | null;
  pushed: boolean;
}

/**
 * Zenn repo の `articles/<id>.md` から orphan zombie 記事を削除し、 commit + push する。
 *
 * caller (syndicate.ts) 側で detect 済みの zombie id リストを渡す前提。 本関数は
 * I/O layer で、 実在確認と git 操作のみを行う。 空リストなら早期 return。
 *
 * @graph-connects none
 */
export async function cleanupOrphanZennArticles(
  args: CleanupOrphanZennArticlesArgs,
): Promise<CleanupOrphanZennArticlesResult> {
  if (args.zombieIds.length === 0) {
    return { deletedFiles: [], commitSha: null, pushed: false };
  }
  if (!existsSync(args.repoDir)) {
    await runGit(["clone", args.remoteUrl, args.repoDir], process.cwd());
  }
  const articlesDir = resolve(args.repoDir, "articles");
  const deleted: string[] = [];
  for (const id of args.zombieIds) {
    const filePath = resolve(articlesDir, `${id}.md`);
    if (!existsSync(filePath)) continue;
    await unlink(filePath);
    deleted.push(`articles/${id}.md`);
  }
  if (deleted.length === 0) {
    return { deletedFiles: [], commitSha: null, pushed: false };
  }
  if (args.dryRun) {
    return { deletedFiles: deleted, commitSha: null, pushed: false };
  }
  for (const path of deleted) {
    await runGit(["add", path], args.repoDir);
  }
  const staged = await runGit(["diff", "--cached", "--quiet"], args.repoDir, { allowFail: true });
  if (staged === 0) {
    return { deletedFiles: deleted, commitSha: null, pushed: false };
  }
  const subject = args.commitSubject ?? `chore: cleanup orphan Zenn articles (${deleted.length})`;
  await runGit(["commit", "-m", subject], args.repoDir);
  const sha = (await runGitOutput(["rev-parse", "HEAD"], args.repoDir)).trim();
  await runGit(["push"], args.repoDir);
  return { deletedFiles: deleted, commitSha: sha, pushed: true };
}

/**
 * git CLI を run。 失敗時は throw (allowFail で exit code を返すモードも可)。
 *
 * @graph-connects none
 */
async function runGit(
  argv: string[],
  cwd: string,
  options: { allowFail?: boolean } = {},
): Promise<number> {
  return new Promise((resolveP, rejectP) => {
    const child = spawn("git", argv, { cwd, stdio: "inherit", env: gitEnv() });
    child.on("error", rejectP);
    child.on("exit", (code: number | null) => {
      if (code === 0 || options.allowFail) resolveP(code ?? 0);
      else rejectP(new Error(`git ${argv.join(" ")} exited ${code}`));
    });
  });
}

/**
 * spawn git 用の env。 husky / pre-commit hook 経由で呼ばれた際に GIT_DIR / GIT_WORK_TREE
 * 等が inherit されると、 cwd で指定した repoDir ではなく parent (呼び出し元) の git dir
 * に commit が漏れる (実際にテストでこの経路が起きた)。 明示的に unset して cwd から
 * repo discovery させる。
 *
 * @graph-connects none
 */
function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  delete env.GIT_COMMON_DIR;
  return env;
}

/**
 * git CLI を run して stdout を return。
 *
 * @graph-connects none
 */
async function runGitOutput(argv: string[], cwd: string): Promise<string> {
  return new Promise((resolveP, rejectP) => {
    const child = spawn("git", argv, {
      cwd,
      stdio: ["ignore", "pipe", "inherit"],
      env: gitEnv(),
    });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
    });
    child.on("error", rejectP);
    child.on("exit", (code: number | null) => {
      if (code === 0) resolveP(out);
      else rejectP(new Error(`git ${argv.join(" ")} exited ${code}`));
    });
  });
}
