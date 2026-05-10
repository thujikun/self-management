/**
 * Better Auth server config (singleton per request)。
 *
 * `getAuth(env)` で env binding (Cloudflare Workers) を受け取り、Drizzle adapter +
 * social providers (GitHub / X) を組み立てる。`@self/db` の `createDb` で生成した
 * client を adapter に流す。
 *
 * env binding contract (CF Workers `env.X` / dev は `process.env`):
 * - `DATABASE_URL` — Neon pooled connection string
 * - `BETTER_AUTH_SECRET` — 32+ char random
 * - `BETTER_AUTH_URL` — 公開 URL (例: `https://ryantsuji.dev`、dev は `http://localhost:3000`)
 * - `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` — GitHub OAuth App
 * - `X_OAUTH2_CLIENT_ID` / `X_OAUTH2_CLIENT_SECRET` — X (Twitter) OAuth 2.0 client
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business Better Auth runtime config。Drizzle adapter で @self/db の user/session/account/verification を SSoT に、social providers (github/twitter) を有効化。env binding は CF Workers と dev で同 shape を期待
 * @graph-connects better-auth [calls] betterAuth() で auth instance を構築、各 route handler に flow
 * @graph-connects content [embeds] @self/db を drizzleAdapter に渡して Postgres を SSoT に
 */

import { account, createDb, session, user, verification } from "@self/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

/**
 * Better Auth が期待する env binding。CF Workers 上では `env`、dev では `process.env`
 * から取り出して渡す。
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
}

/**
 * env から Better Auth instance を構築。1 request 1 instance を想定 (Workers
 * isolate モデルに合わせて lazy)。
 *
 * @graph-connects better-auth [provides] betterAuth instance を返す
 */
export function getAuth(env: AuthEnv) {
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
    },
  });
}

/** @graph-connects none */
export type Auth = ReturnType<typeof getAuth>;
