/**
 * Better Auth client (browser side)。
 *
 * `signIn` / `signOut` / `useSession` を呼ぶ口。base URL は同一 origin (`/api/auth`)
 * を経由するので server config の `baseURL` と一致させて初期化する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business Better Auth client。同一 origin の /api/auth 経由でサーバ側 handler を叩く。signIn.social({ provider: "github" }) のような UI ハンドラ用 entry
 * @graph-connects better-auth [calls] createAuthClient で client instance を作る
 */

import { createAuthClient } from "better-auth/react";

/** @graph-connects better-auth [provides] auth client instance */
export const authClient = createAuthClient();

/** @graph-connects none */
export const { signIn, signOut, useSession } = authClient;
