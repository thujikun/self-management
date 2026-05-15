/**
 * `/sign-in` — sign-in page (GitHub / X / Google / Apple / Facebook OAuth)。
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
 * @graph-business 認証入口 page。GitHub / X / Google / Apple / Facebook OAuth の 5 ボタンを置く minimal UI、callbackURL は ?redirect= 経由で動的に決定 (open redirect を防ぐため同一 origin 相対 path のみ受理)。sign-up は open (provider 経由の身元確認に委ねる)
 * @graph-connects tanstack-router [provides] /sign-in route
 * @graph-connects better-auth [calls] signIn.social でプロバイダ OAuth に飛ばす
 */

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { signIn } from "../lib/auth-client.js";

/**
 * `?redirect=` で受け取る戻り先 path の許容判定 (open redirect = CWE-601 ガード):
 * - `/` で始まる相対 path のみ
 * - 2 文字目が `/`, `\`, `%2f` / `%5c` (URL-encoded slash / backslash) なら reject
 *   - `\` を許すと一部ブラウザが `Location:` 内で `/` に正規化し protocol-relative
 *     URL (`//evil.com`) → 外部 redirect される
 *   - `%2f` を許すと URL-decode 後に `//evil.com` 化する経路を防げない
 * - 単独 `/` (root) は許す
 * - fallback (空 / 不正値) は呼び出し側で `/account` を入れる前提
 *
 * @graph-connects none
 */
export function isSafeRedirect(value: string): boolean {
  if (!value.startsWith("/")) return false;
  if (value === "/") return true;
  const second = value.slice(1, 2);
  if (second === "/" || second === "\\") return false;
  // URL-encoded slash (%2f / %5c) を 2 文字目に持つ pattern も拒否。
  const encodedHead = value.slice(1, 4).toLowerCase();
  if (encodedHead.startsWith("%2f") || encodedHead.startsWith("%5c")) return false;
  return true;
}

/** @graph-connects none */
const SearchSchema = z.object({
  redirect: z
    .string()
    .refine(
      isSafeRedirect,
      "must be a same-origin path (no `//`, `/\\`, or %-encoded slash prefix)",
    )
    .optional(),
});

/**
 * sign-in 系 OAuth provider 名 (Better Auth の social provider key と一致)。
 *
 * @graph-connects none
 */
type Provider = "github" | "twitter" | "google" | "apple" | "facebook";

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
 * provider + callbackURL を closure に焼き込んだ click handler factory。
 * test から直接 invoke できるよう module 外に切り出してある (component 内の
 * inline arrow に書くと React element shape 経由でしか呼べず壊れやすい)。
 *
 * @graph-connects better-auth [calls] startSocialSignIn 経由で signIn.social
 */
export function buildOnClick(provider: Provider, callbackURL: string): () => void {
  return () => startSocialSignIn(provider, callbackURL);
}

/**
 * sign-in ボタン (1 provider 1 つ) を描画する小さい component。onClick は
 * `buildOnClick(provider, callbackURL)` で生成した handler を bind するだけ。
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
  return (
    <button type="button" className={className} onClick={buildOnClick(provider, callbackURL)}>
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
      <p className="auth__lead">good で comments / likes を有効化。</p>
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
        <li>
          <SignInButton
            provider="google"
            callbackURL={callbackURL}
            label="continue with Google"
            className="auth__provider auth__provider--google"
          />
        </li>
        <li>
          <SignInButton
            provider="apple"
            callbackURL={callbackURL}
            label="continue with Apple"
            className="auth__provider auth__provider--apple"
          />
        </li>
        <li>
          <SignInButton
            provider="facebook"
            callbackURL={callbackURL}
            label="continue with Facebook"
            className="auth__provider auth__provider--facebook"
          />
        </li>
      </ul>
    </main>
  );
}
