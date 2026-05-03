# @self/graph-product

ryan-product-graph の build pipeline。schema 定義、BQ table 作成、markdown migration、ingest pipeline を一括管理。

詳細は [`docs/product-graph/README.md`](../../../docs/product-graph/README.md) を参照。

## scripts

```bash
# BQ table 作成 (idempotent、Pulumi で dataset を作った後)
pnpm init-bq

# graph 全体ビルド (markdown migrate → BQ load)
pnpm build-graph

# 部分実行
pnpm tsx scripts/build-graph.ts --dry-run
pnpm tsx scripts/build-graph.ts --only=migrate
```

## structure

```
src/
├── schema/             # node/edge type 定義 + BQ table schema (SSoT)
│   ├── node-types.ts   # NodeType enum, DOMAINS list
│   ├── edge-types.ts   # EdgeType enum
│   ├── bq-schema.ts    # @google-cloud/bigquery 形式の TableSchema
│   └── index.ts        # re-exports
├── parsers/            # 各種ソースからノード抽出
│   ├── markdown/       # 既存 markdown (operations/log.md, threads/, decisions/) → nodes
│   ├── x/              # X API → nodes/edges
│   ├── zenn/           # Zenn RSS / API → content nodes
│   └── devto/          # dev.to API → content nodes
├── edge-detectors/     # ノード間のエッジを推定
│   └── ...
├── generators/         # AI 生成 summary 等
│   └── summary.ts
└── migrate/            # 既存 markdown を BQ にバルク移行
    └── ...

scripts/
├── init-bq.ts          # BQ table を作成 (実行: pnpm init-bq)
└── build-graph.ts      # 全体ビルド orchestrator (実行: pnpm build-graph)
```

## SSoT

TypeScript の `src/schema/` が node/edge schema の Single Source of Truth。

- BQ table schema は `bq-schema.ts` から導出
- ESLint rule (将来) で markdown 上の `@graph-*` タグの値を node-type / edge-type と整合性検証

## 関連

- [`docs/product-graph/README.md`](../../../docs/product-graph/README.md) — 全体設計
- [`infra/core/`](../../../infra/core/) — BQ dataset / service account の provisioning
