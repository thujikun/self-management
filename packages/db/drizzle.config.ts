/**
 * drizzle-kit 設定。`pnpm drizzle:generate` / `:push` / `:studio` から参照される。
 *
 * - `dialect: "postgresql"` (Neon は Postgres 17 互換)
 * - `schema`: `src/schema/index.ts` を起点 (barrel から table を全部読む)
 * - `out`: `migrations/` に SQL を吐く (gitignore 対象外、commit する)
 * - `dbCredentials.url`: `process.env.DATABASE_URL` (`.envrc.local` から direnv 経由)
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business drizzle-kit の設定。schema は src/schema/index.ts を参照、生成 SQL は migrations/ に commit、credential は env 経由 (.envrc.local + wrangler secret 両方を期待)
 * @graph-connects drizzle-kit [embeds] schema → migration SQL の generator pipeline
 */

import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Set it in `.envrc.local` (dev) or via `wrangler secret put DATABASE_URL` (production).",
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  // 安全側: drizzle:push を打つ前に diff を見たいので strict mode。
  strict: true,
  // verbose で実行 SQL を出す (CI / dev で何が走ってるか追える)。
  verbose: true,
});
