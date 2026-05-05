# syntax=docker/dockerfile:1
#
# @self/graph-product のミグレーション (X ingest 含む) を Cloud Run Job で動かすための image。
#
# 設計:
# - node:24-alpine + pnpm (catalog 固定の 10.33.2)
# - pnpm workspace の subgraph (@self/graph-product + 依存 @self/embedding / @self/otel) のみ install
# - tsx で直接 TS を実行 (TS build step 不要、image size 抑えるため)
# - default CMD: `--source=x --incremental` (Cloud Run Job + Scheduler から daily 起動される)
#
# build:
#   docker build -f apps/graph/product/Dockerfile -t graph-product .
# (build context は repo root に固定 = workspace 全体を見るため)

FROM node:24-alpine

# corepack で pnpm を有効化 (catalog で pin した version に揃える)
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

WORKDIR /app

# 1. workspace metadata + 関連 package.json を先にコピー (layer cache のため)
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/graph/product/package.json ./apps/graph/product/
COPY packages/embedding/package.json ./packages/embedding/
COPY packages/otel/package.json ./packages/otel/

# 2. graph-product のサブグラフだけ install (... で自身の deps + workspace deps を含む)
RUN pnpm install --frozen-lockfile --filter "@self/graph-product..."

# 3. 実ソースをコピー (workspace deps の TS も必要、tsx で直接実行するため)
COPY packages/embedding ./packages/embedding
COPY packages/otel ./packages/otel
COPY apps/graph/product ./apps/graph/product

ENV NODE_ENV=production

# Cloud Run Job から override 可能 (例: incremental→full backfill)
CMD ["pnpm", "--filter", "@self/graph-product", "migrate", "--", "--source=x", "--incremental"]
