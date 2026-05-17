/**
 * createServerFn handler 内から **現在のリクエストの認証 session を取り出す** ための薄い helper。
 *
 * Better Auth の `auth.api.getSession({ headers })` はリクエスト header からセッションを
 * 解決するので、TanStack Start の `getRequestHeaders()` で得た header を流すだけで使える。
 *
 * 戻り値:
 * - `null` — 未認証 (cookie が無い / 期限切れ / invalid)
 * - `{ user, session }` — 認証済み (Better Auth が validate 済の user / session を返す)
 *
 * 個人サイト方針: comments / likes は authenticated user のみ。本 helper を呼んだ後に
 * `if (!sess) throw new Error("UNAUTHENTICATED")` で gate する想定。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business createServerFn handler の中で「今のリクエストは誰か」を取り出すための薄い wrapper。Better Auth の getSession を request header 経由で叩くだけ。comments / likes 側のサーバ関数で auth gate に使う
 * @graph-connects better-auth [calls] auth.api.getSession({ headers }) で session 解決
 */

import { getAuth, type AuthEnv } from "./auth.js";

/**
 * `auth.api.getSession({ headers })` の戻り値型 (Better Auth が型を expose していないので
 * 手で軽く絞る)。後で Better Auth が型を上げてくれたら差し替える。
 *
 * @graph-connects none
 */
export interface AuthSession {
  user: {
    id: string;
    email: string;
    name: string;
    image: string | null;
  };
  session: {
    id: string;
    userId: string;
    expiresAt: Date | string;
  };
}

/**
 * Better Auth の getSession に **Headers を渡して** session を取得する pure 関数。
 * 引数で渡す形にして test 時は fake env / fake headers で直接叩ける。
 *
 * @graph-connects better-auth [calls] auth.api.getSession({ headers })
 */
export async function getSessionFromHeaders(
  headers: Headers,
  env: AuthEnv,
): Promise<AuthSession | null> {
  const auth = getAuth(env);
  const result = await auth.api.getSession({ headers });
  if (!result) return null;
  return result as AuthSession;
}

/**
 * draft post の preview 権限。`env.ADMIN_EMAIL` が設定されていて、かつ request の
 * session.user.email が一致した時のみ true を返す。未設定 / 未認証 / email 不一致は false。
 *
 * listing / 詳細 / series loader はこの戻り値を `includeDrafts` フラグに流す。RSS
 * など公開 feed 経路はこの関数を呼ばず常に false 相当の挙動を貫く (anonymous reader
 * が draft URL を踏んでも 404、admin 経由で踏むと preview 可能)。
 *
 * @graph-connects better-auth [calls] getSessionFromHeaders で email を比較
 */
export async function isAdminRequest(
  headers: Headers,
  env: AuthEnv & { ADMIN_EMAIL?: string },
): Promise<boolean> {
  if (!env.ADMIN_EMAIL) return false;
  const sess = await getSessionFromHeaders(headers, env);
  if (!sess) return false;
  return sess.user.email === env.ADMIN_EMAIL;
}
