/**
 * graph 全体 build orchestrator。
 * markdown migration、X API ingest、Zenn/dev.to fetch、edge detection、summary 生成 を順次実行する。
 *
 * 現状は skeleton。各 phase の実装は src/parsers/, src/migrate/, src/edge-detectors/ に追加予定。
 *
 * 実行: `pnpm --filter @self/graph-product build-graph [--dry-run] [--only=migrate|ingest|edges]`
 */

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const only = [...args].find((a) => a.startsWith("--only="))?.split("=")[1];

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
