/**
 * graph 全体 build orchestrator。
 * markdown migration、X API ingest、Zenn/dev.to fetch、edge detection、summary 生成 を順次実行する。
 *
 * 現状は skeleton。各 phase の実装は src/parsers/, src/migrate/, src/edge-detectors/ に追加予定。
 *
 * 実行: `pnpm --filter @self/graph-product build-graph [--dry-run] [--only=migrate|ingest|edges]`
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business graph 全体 build の上位 orchestrator (skeleton)。migrate / ingest / edges / summaries の各フェーズを順次起動する将来の cron entry。現状は移行作業 P2 を migrate.ts に分離してあり、ここは P3 以降の統合先
 * @graph-connects none
 */

/** @graph-connects none */
const args = new Set(process.argv.slice(2));
/** @graph-connects none */
const dryRun = args.has("--dry-run");
/** @graph-connects none */
const only = [...args].find((a) => a.startsWith("--only="))?.split("=")[1];

/**
 * 各 phase を順次呼び出す skeleton。各 phase の本体は将来 src/ 配下から import する想定。
 *
 * @graph-connects none
 */
async function main(): Promise<void> {
  console.log(`build-graph (dryRun=${dryRun}, only=${only ?? "all"})`);

  if (!only || only === "migrate") {
    console.log("[migrate] markdown → BQ (TODO)");
    // TODO: src/migrate を呼ぶ
  }

  if (!only || only === "ingest") {
    console.log("[ingest] X / Zenn / dev.to → BQ (TODO)");
    // TODO: src/parsers/x, src/parsers/zenn, src/parsers/devto を呼ぶ
  }

  if (!only || only === "edges") {
    console.log("[edges] エッジ生成 + 推論 (TODO)");
    // TODO: src/edge-detectors を呼ぶ
  }

  if (!only || only === "summaries") {
    console.log("[summaries] AI による body_summary 生成 (TODO)");
    // TODO: src/generators/summary を呼ぶ
  }

  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
