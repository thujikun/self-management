/**
 * `/sign-in` — sign-in page (GitHub / X OAuth)。
 *
 * 認証は Better Auth の social provider に丸投げ。`signIn.social({ provider })` を
 * 呼ぶと `/api/auth/sign-in/social/<provider>` に POST → provider の OAuth endpoint
 * へ redirect → callback で session が確立する。
 *
 * 戻り先は **`?redirect=<path>` query param で動的**:
 * - 例: `/sign-in?redirect=/posts/hello-world` → 認証後そのまま記事に戻る
 * - 不正値 (相対パス以外 / open redirect 候補) は schema validation で reject、
 *   絞り込みに失敗した時は `/account` に fallback
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business 認証入口 page。GitHub / X の OAuth ボタンだけを置く minimal な UI、callbackURL は ?redirect= 経由で動的に決定 (open redirect を防ぐため同一 origin 相対 path のみ受理)
 * @graph-connects tanstack-router [provides] /sign-in route
 * @graph-connects better-auth [calls] signIn.social でプロバイダ OAuth に飛ばす
 */

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { signIn } from "../lib/auth-client.js";

/**
 * `?redirect=` で受け取る戻り先 path。**同一 origin の相対 path のみ** 許容
 * (open redirect 攻撃防止)。fallback は `/account`。
 *
 * @graph-connects none
 */
const SearchSchema = z.object({
  redirect: z
    .string()
    .regex(/^\/[^/].*/, "must start with `/` and not be `//` or external")
    .optional(),
});

/**
 * sign-in 系 OAuth provider 名 (Better Auth の social provider key と一致)。
 *
 * @graph-connects none
 */
type Provider = "github" | "twitter";

/**
 * provider + callbackURL を渡して `signIn.social` を呼ぶ純関数。test から直接
 * 呼べるよう route component から切り出してある。
 *
 * @graph-connects better-auth [calls] signIn.social
 */
export function startSocialSignIn(provider: Provider, callbackURL: string): void {
  signIn.social({ provider, callbackURL });
}

/**
 * sign-in ボタン (1 provider 1 つ) を描画する小さい component。onClick は
 * `startSocialSignIn(provider, callbackURL)` を呼ぶ named local function に固定し、
 * JSX から inline arrow を排除して test 側から click handler を直接呼べる shape にする。
 *
 * @graph-connects none
 */
export function SignInButton({
  provider,
  callbackURL,
  label,
  className,
}: {
  provider: Provider;
  callbackURL: string;
  label: string;
  className: string;
}) {
  function onClick(): void {
    startSocialSignIn(provider, callbackURL);
  }
  return (
    <button type="button" className={className} onClick={onClick}>
      {label}
    </button>
  );
}

/** @graph-connects tanstack-router [provides] /sign-in route */
export const Route = createFileRoute("/sign-in")({
  validateSearch: SearchSchema,
  component: SignInPage,
});

/** @graph-connects none */
function SignInPage() {
  const { redirect } = Route.useSearch();
  const callbackURL = redirect ?? "/account";

  return (
    <main className="auth">
      <h1>sign in</h1>
      <p className="auth__lead">soon でコメントや like を有効化する予定。</p>
      <ul className="auth__providers">
        <li>
          <SignInButton
            provider="github"
            callbackURL={callbackURL}
            label="continue with GitHub"
            className="auth__provider auth__provider--github"
          />
        </li>
        <li>
          <SignInButton
            provider="twitter"
            callbackURL={callbackURL}
            label="continue with X"
            className="auth__provider auth__provider--x"
          />
        </li>
      </ul>
    </main>
  );
}
