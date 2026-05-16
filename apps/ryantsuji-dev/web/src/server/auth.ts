/**
 * Better Auth server config。env binding を **`createServerFn` / route handler の
 * `context.env`** から受け取り、Drizzle adapter + social providers (GitHub / X /
 * Google) で sign-in を成立させる。`@self/db` の `createDb` で生成した client を
 * adapter に流す。
 *
 * Apple は Developer Program (有料) + JWT clientSecret の半年毎手動 rotation 負担に、
 * Facebook は Meta App Review プロセス + App Domain / Valid OAuth Redirect URI の
 * 二重設定要件に対して個人サイトの ROI が見合わないため未対応。
 *
 * env binding contract (CF Workers の env binding shape、`start.ts:Env` 参照):
 * - `DATABASE_URL` — Neon pooled connection string
 * - `BETTER_AUTH_SECRET` — 32+ char random
 * - `BETTER_AUTH_URL` — 公開 URL (例: `https://ryantsuji.dev`、dev は `http://localhost:3000`)
 * - `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` — GitHub OAuth App
 * - `X_OAUTH2_CLIENT_ID` / `X_OAUTH2_CLIENT_SECRET` — X (Twitter) OAuth 2.0 client
 * - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — Google Cloud OAuth 2.0 client
 *
 * `process.env` 経路は廃止 (CF Workers では module scope で undefined になる)。
 * `src/server.ts` (Worker entry) が `(req, env, ctx)` を `requestContext` に詰めて、
 * 各 handler で `context.env.X` で型付きアクセス。dev では `@cloudflare/vite-plugin`
 * が `.dev.vars` から env を inject する同 shape。
 *
 * sign-up の方針: **open** (GitHub / X OAuth を完走した任意の user が sign-up 可能)。
 * 本人確認と spam 防御は OAuth provider (GitHub / X) の account 検証に委ねる設計で、
 * ryantsuji.dev 側では allowlist を持たない。問題が出てきたら moderation (soft-delete)
 * や rate limit を追加する方向で対処する。
 *
 * 性能: `getAuth(env)` は betterAuth instance を Workers isolate ごとに **1 度だけ**
 * 構築して `globalThis` cache (`Cache key` で同 env なら reuse)。Workers isolate 寿命中
 * (~分単位、region 内 reuse) は cache hit、cold start のみ構築コスト。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business Better Auth runtime config。Drizzle adapter で @self/db を SSoT に、social providers (github/twitter/google) を有効化、sign-up は open (OAuth provider 経由の身元確認に委ねる方針)。env は CF Workers binding 由来 (process.env 不使用)、isolate ごとに globalThis cache で per-request 再構築を回避
 * @graph-connects better-auth [calls] betterAuth() で auth instance を構築、各 route handler に flow
 * @graph-connects content [embeds] @self/db を drizzleAdapter に渡して Postgres を SSoT に
 */

import { account, createDb, session, user, verification } from "@self/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

/**
 * Better Auth が期待する env binding subset。`start.ts:Env` の認証関連 field の subset。
 *
 * @graph-connects none
 */
export interface AuthEnv {
  DATABASE_URL: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  X_OAUTH2_CLIENT_ID: string;
  X_OAUTH2_CLIENT_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
}

/**
 * env から Better Auth instance を構築する pure factory。本関数自体は cache 無し。
 * `getAuth(env)` (export) が globalThis cache を被せた wrapper として呼ぶ。test では
 * 直接 invoke しても cache の影響を受けない設計。
 *
 * @graph-connects better-auth [provides] betterAuth instance を構築
 */
export function buildAuth(env: AuthEnv) {
  const db = createDb(env.DATABASE_URL);
  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { user, session, account, verification },
    }),
    socialProviders: {
      github: {
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
      },
      twitter: {
        clientId: env.X_OAUTH2_CLIENT_ID,
        clientSecret: env.X_OAUTH2_CLIENT_SECRET,
      },
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
    },
  });
}

/**
 * cache key を env から決定する。OAuth/DB credential が変われば key が変わるので、
 * stale credential で auth する事故を防ぐ。
 *
 * @graph-connects none
 */
export function authCacheKey(env: AuthEnv): string {
  return [
    env.DATABASE_URL,
    env.BETTER_AUTH_SECRET,
    env.BETTER_AUTH_URL,
    env.GITHUB_CLIENT_ID,
    env.GITHUB_CLIENT_SECRET,
    env.X_OAUTH2_CLIENT_ID,
    env.X_OAUTH2_CLIENT_SECRET,
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
  ].join("|");
}

/**
 * globalThis 上に置く isolate-scoped cache。Workers isolate 寿命中は同 env なら同 instance を
 * reuse。Workers の cold start で globalThis は新規 isolate 用に空からスタートするので
 * stale leak のリスクは isolate lifetime のみ。
 *
 * @graph-connects none
 */
interface IsolateAuthCache {
  key: string;
  auth: ReturnType<typeof buildAuth>;
}
/** @graph-connects none */
const AUTH_CACHE_SYMBOL = Symbol.for("@self/ryantsuji-dev-web/auth-cache");
/** @graph-connects none */
type GlobalWithAuthCache = typeof globalThis & {
  [AUTH_CACHE_SYMBOL]?: IsolateAuthCache;
};

/**
 * env から Better Auth instance を取得。Workers isolate ごとに同 env なら **再構築せず
 * cache** から返す。env (cache key) が変わった時は build しなおして cache を差し替え。
 *
 * @graph-connects better-auth [provides] betterAuth instance を返す (isolate cache 経由)
 */
export function getAuth(env: AuthEnv) {
  const g = globalThis as GlobalWithAuthCache;
  const key = authCacheKey(env);
  const cached = g[AUTH_CACHE_SYMBOL];
  if (cached && cached.key === key) return cached.auth;
  const auth = buildAuth(env);
  g[AUTH_CACHE_SYMBOL] = { key, auth };
  return auth;
}

/** @graph-connects none */
export type Auth = ReturnType<typeof getAuth>;

/**
 * test 用に cache を明示的に reset する。production code からは呼ばない。
 *
 * @graph-connects none
 */
export function _resetAuthCacheForTest(): void {
  const g = globalThis as GlobalWithAuthCache;
  delete g[AUTH_CACHE_SYMBOL];
}
