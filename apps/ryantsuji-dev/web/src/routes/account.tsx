/**
 * `/account` — sign-in 後の account view。
 *
 * `useSession` で session を取得し、未認証なら sign-in 案内、認証済みなら user info
 * + sign-out ボタンを出す minimal page。ここを comments / likes 機能の起点にする想定。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business sign-in 後 landing。useSession で auth state を取り、未認証時は /sign-in 誘導、認証済みなら user.name / image + sign-out ボタンを表示。後続の comments / likes 機能の起点
 * @graph-connects tanstack-router [provides] /account route
 * @graph-connects better-auth [calls] useSession + signOut
 */

import { Link, createFileRoute } from "@tanstack/react-router";

import { signOut, useSession } from "../lib/auth-client.js";

/**
 * sign-out を発火する純関数。test から直接呼べるよう component から切り出してある。
 *
 * @graph-connects better-auth [calls] signOut で session を無効化
 */
export function endSession(): void {
  signOut();
}

/** @graph-connects tanstack-router [provides] /account route */
export const Route = createFileRoute("/account")({
  component: AccountPage,
});

/** @graph-connects none */
function AccountPage() {
  const { data, isPending } = useSession();

  if (isPending) {
    return (
      <main className="auth">
        <p>checking session...</p>
      </main>
    );
  }

  if (!data?.user) {
    return (
      <main className="auth">
        <h1>not signed in</h1>
        <p>
          <Link to="/sign-in" search={{ redirect: "/account" }}>
            → sign in
          </Link>
        </p>
      </main>
    );
  }

  const { user } = data;
  return (
    <main className="auth">
      <h1>account</h1>
      <dl className="auth__profile">
        <dt>avatar</dt>
        <dd>
          {user.image ? (
            <img src={user.image} alt="" width={48} height={48} className="auth__avatar" />
          ) : (
            "—"
          )}
        </dd>
        <dt>name</dt>
        <dd>{user.name}</dd>
        <dt>email</dt>
        <dd>{user.email}</dd>
      </dl>
      <button type="button" className="auth__signout" onClick={endSession}>
        sign out
      </button>
    </main>
  );
}
