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

import { mkdir, readFile, writeFile } from "node:fs/promises";
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

/**
 * git CLI を run。失敗時は throw (allowFail で exit code を返すモードも可)。
 *
 * @graph-connects none
 */
async function runGit(
  argv: string[],
  cwd: string,
  options: { allowFail?: boolean } = {},
): Promise<number> {
  return new Promise((resolveP, rejectP) => {
    const child = spawn("git", argv, { cwd, stdio: "inherit" });
    child.on("error", rejectP);
    child.on("exit", (code: number | null) => {
      if (code === 0 || options.allowFail) resolveP(code ?? 0);
      else rejectP(new Error(`git ${argv.join(" ")} exited ${code}`));
    });
  });
}

/**
 * git CLI を run して stdout を return。
 *
 * @graph-connects none
 */
async function runGitOutput(argv: string[], cwd: string): Promise<string> {
  return new Promise((resolveP, rejectP) => {
    const child = spawn("git", argv, { cwd, stdio: ["ignore", "pipe", "inherit"] });
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
