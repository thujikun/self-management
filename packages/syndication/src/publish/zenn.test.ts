/**
 * `publishToZenn` の integration test。OS の tmpdir に local bare repo + working
 * clone を建て、実 git CLI で動作確認する (mock せず本物の child_process)。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business Zenn publish 層を real git で integration test。tmpdir に bare upstream + working clone を建て、初回 publish (clone なし状態からの自動 clone) / 既存記事の update / no-change skip / dry-run の 4 mode を網羅
 * @graph-connects none
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { publishToZenn } from "./zenn.js";

function gitSync(argv: string[], cwd: string): { code: number; stdout: string } {
  const r = spawnSync("git", argv, { cwd, encoding: "utf8" });
  return { code: r.status ?? 1, stdout: r.stdout };
}

/** test 用に commit author を設定した bare upstream + 一時 working dir を構築 */
async function makeRepos(): Promise<{ root: string; bare: string; workDir: string }> {
  const root = await mkdtemp(resolve(tmpdir(), "zenn-publish-test-"));
  const bare = resolve(root, "bare.git");
  const workDir = resolve(root, "work");
  gitSync(["init", "--bare", "--initial-branch=main", bare], root);
  // working clone を 1 回作っておく (publishToZenn の既 clone 経路を踏むため)
  gitSync(["clone", bare, workDir], root);
  gitSync(["config", "user.email", "test@example.com"], workDir);
  gitSync(["config", "user.name", "test"], workDir);
  // bare は受信時 main branch を更新する必要があるので、初回 commit を入れて HEAD を初期化
  gitSync(["commit", "--allow-empty", "-m", "init"], workDir);
  gitSync(["push", "-u", "origin", "main"], workDir);
  return { root, bare, workDir };
}

describe("publishToZenn (integration with real git)", () => {
  let repos: { root: string; bare: string; workDir: string };

  beforeEach(async () => {
    repos = await makeRepos();
  });

  afterEach(async () => {
    await rm(repos.root, { recursive: true, force: true });
  });

  it("dryRun=true は file 書き込みのみ、commit / push 無し", async () => {
    const result = await publishToZenn({
      repoDir: repos.workDir,
      remoteUrl: repos.bare,
      zennId: "abc1234",
      markdown: "---\ntitle: x\n---\nbody",
      dryRun: true,
    });
    expect(result.commitSha).toBeNull();
    expect(result.pushed).toBe(false);
    // file は書かれている
    const written = await readFile(result.filePath, "utf8");
    expect(written).toContain("body");
    // 何も commit していない
    const log = gitSync(["log", "--oneline"], repos.workDir);
    expect(log.stdout.trim().split("\n").length).toBe(1); // init commit のみ
  });

  it("初回 publish: file 書き込み + commit + push される", async () => {
    const result = await publishToZenn({
      repoDir: repos.workDir,
      remoteUrl: repos.bare,
      zennId: "fresh1",
      markdown: "---\ntitle: y\n---\nfresh body",
    });
    expect(result.pushed).toBe(true);
    expect(result.commitSha).toMatch(/^[0-9a-f]{40}$/);
    // bare 側に反映されているか (clone してきて確認)
    const verifyDir = resolve(repos.root, "verify");
    gitSync(["clone", repos.bare, verifyDir], repos.root);
    const verified = await readFile(resolve(verifyDir, "articles/fresh1.md"), "utf8");
    expect(verified).toContain("fresh body");
  });

  it("同じ markdown を再度渡すと no-change で commit / push skip", async () => {
    const md = "---\ntitle: z\n---\nstable";
    await publishToZenn({
      repoDir: repos.workDir,
      remoteUrl: repos.bare,
      zennId: "same1",
      markdown: md,
    });
    const second = await publishToZenn({
      repoDir: repos.workDir,
      remoteUrl: repos.bare,
      zennId: "same1",
      markdown: md,
    });
    expect(second.commitSha).toBeNull();
    expect(second.pushed).toBe(false);
  });

  it("既存 article を異なる内容で更新すると commit + push される", async () => {
    await publishToZenn({
      repoDir: repos.workDir,
      remoteUrl: repos.bare,
      zennId: "upd1",
      markdown: "---\ntitle: v1\n---\nfirst",
    });
    const second = await publishToZenn({
      repoDir: repos.workDir,
      remoteUrl: repos.bare,
      zennId: "upd1",
      markdown: "---\ntitle: v2\n---\nsecond",
      commitSubject: "chore: update v2",
    });
    expect(second.pushed).toBe(true);
    const log = gitSync(["log", "--oneline", "-1"], repos.workDir);
    expect(log.stdout).toContain("chore: update v2");
  });
});
