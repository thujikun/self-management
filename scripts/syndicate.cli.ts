#!/usr/bin/env tsx
/*
 * syndicate CLI thin entry。argv parse / file resolve / glue だけ持ち、
 * 実 logic は `syndicate.ts` 側。`.cli.ts` は `vitest.config.ts` の coverage
 * exclude 対象 (`scripts/*.cli.ts`) で、process.argv / process.exit / 標準入出力
 * 依存の薄い entry を unit test 対象外に逃がす compact-log と同じ分離パターン。
 *
 * 使い方:
 *   pnpm tsx scripts/syndicate.cli.ts --target zenn               # 全 .ja.md (dry-run)
 *   pnpm tsx scripts/syndicate.cli.ts --target devto              # 全 .en.md (dry-run)
 *   pnpm tsx scripts/syndicate.cli.ts --target zenn --slug X      # 単一 slug
 *   pnpm tsx scripts/syndicate.cli.ts --target all                # zenn + devto 両方
 *   pnpm tsx scripts/syndicate.cli.ts --target zenn --publish     # Zenn repo に commit & push
 *   pnpm tsx scripts/syndicate.cli.ts --target devto --publish    # dev.to API PUT で更新
 *   pnpm tsx scripts/syndicate.cli.ts --target zenn --include-drafts --slug _x --publish
 *     # draft: true の post を含めて publish (Zenn / dev.to 側の frontmatter は
 *     # `published: false` 評価され「下書き」状態で同期される)。連携経路テスト用
 *
 * env:
 *   DEV_TO_API_KEY              dev.to publish に必要 (`--target devto --publish`)
 *   RYANTSUJI_CONTENT_REPO_DIR  Zenn 用 local clone path
 *                               default: ~/Workspace/ryantsuji-dev-content
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business syndicate CLI thin entry。argv を parse して logic 層 (emitZenn / emitDevto) を順次呼ぶ。process.argv / process.exit / footer file 読み込みのみを持ち、純粋 logic は syndicate.ts 側に分離
 * @graph-connects none
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { OUT_DIR, ZENN_FOOTER_PATH, emitDevto, emitZenn, readAllPosts } from "./syndicate.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const targetIdx = args.indexOf("--target");
  const target = targetIdx >= 0 ? args[targetIdx + 1] : "all";
  const slugIdx = args.indexOf("--slug");
  const slug = slugIdx >= 0 ? args[slugIdx + 1] : undefined;
  const publish = args.includes("--publish");
  const includeDrafts = args.includes("--include-drafts");
  if (target !== "zenn" && target !== "devto" && target !== "all") {
    console.error(`unknown --target: ${target} (zenn | devto | all)`);
    process.exit(1);
  }

  const posts = await readAllPosts(undefined, { includeDrafts });
  console.log(
    `loaded ${posts.length} posts (target=${target}${slug ? `, slug=${slug}` : ""}${publish ? ", publish" : ", dry-run"}${includeDrafts ? ", include-drafts" : ""})`,
  );

  // CLI 起動時に now を 1 度 fix し、Zenn / dev.to の publishAt 判定が同一 Date を
  // 共有するようにする。process 内で publishAt 境界をまたいでも一貫した published 値になる
  const now = new Date();

  if (target === "zenn" || target === "all") {
    const footer = await readFile(ZENN_FOOTER_PATH, "utf8");
    await emitZenn({
      posts,
      outDir: resolve(OUT_DIR, "zenn"),
      footer,
      slug,
      publish,
      now,
    });
  }
  if (target === "devto" || target === "all") {
    await emitDevto({
      posts,
      outDir: resolve(OUT_DIR, "devto"),
      slug,
      publish,
      now,
    });
  }
  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
