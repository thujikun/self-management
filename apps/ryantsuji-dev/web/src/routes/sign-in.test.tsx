/**
 * `/sign-in` route の SSR + click handler test。
 *
 * SSR では GitHub / X ボタンが両方 render されることを確認、click handler は
 * 切り出した `startSocialSignIn(provider, callbackURL)` を直接呼んで
 * `signIn.social` に正しい args が伝わることを保証する (browser DOM 不要)。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business sign-in route の SSR + click handler 整合性。GitHub / X ボタンが両方 render され、startSocialSignIn が provider + callbackURL を Better Auth signIn.social に渡すことを保証
 * @graph-connects none
 */

import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getRouter } from "../router.js";
import { Route, SignInButton, startSocialSignIn } from "./sign-in.js";

const mockSignInSocial = vi.fn();
vi.mock("../lib/auth-client.js", () => ({
  authClient: {},
  signIn: { social: (args: unknown) => mockSignInSocial(args) },
  signOut: vi.fn(),
  useSession: vi.fn(),
}));

async function ssrAt(path: string): Promise<string> {
  const router = getRouter({
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  return renderToString(<RouterProvider router={router} />);
}

describe("/sign-in SSR", () => {
  it("GitHub / X 両方の OAuth ボタンが render される", async () => {
    const html = await ssrAt("/sign-in");
    expect(html).toMatch(/continue with GitHub/);
    expect(html).toMatch(/continue with X/);
    expect(html).toMatch(/<h1>sign in<\/h1>/);
  });

  it("?redirect=/posts/foo を渡しても sign-in page は render される", async () => {
    const html = await ssrAt("/sign-in?redirect=%2Fposts%2Ffoo");
    expect(html).toMatch(/continue with GitHub/);
  });

  it("Route export は validateSearch / component を持つ", () => {
    expect(typeof Route.options.component).toBe("function");
    expect(Route.options.validateSearch).toBeTypeOf("object");
  });
});

describe("startSocialSignIn", () => {
  beforeEach(() => mockSignInSocial.mockReset());
  afterEach(() => mockSignInSocial.mockReset());

  it("provider + callbackURL を signIn.social に渡す (github)", () => {
    startSocialSignIn("github", "/account");
    expect(mockSignInSocial).toHaveBeenCalledWith({
      provider: "github",
      callbackURL: "/account",
    });
  });

  it("provider + callbackURL を signIn.social に渡す (twitter / X)", () => {
    startSocialSignIn("twitter", "/posts/foo");
    expect(mockSignInSocial).toHaveBeenCalledWith({
      provider: "twitter",
      callbackURL: "/posts/foo",
    });
  });
});

describe("SignInButton", () => {
  beforeEach(() => mockSignInSocial.mockReset());
  afterEach(() => mockSignInSocial.mockReset());

  it("button render に label と className が反映される", () => {
    const html = renderToString(
      createElement(SignInButton, {
        provider: "github",
        callbackURL: "/account",
        label: "continue with GitHub",
        className: "auth__provider auth__provider--github",
      }),
    );
    expect(html).toMatch(/<button[^>]*class="auth__provider auth__provider--github"/);
    expect(html).toMatch(/continue with GitHub/);
  });

  it("button の onClick prop を直接呼ぶと signIn.social に渡る", () => {
    // SSR では React は props を持つ要素を返すだけ。createElement で要素を作って
    // props.onClick を引き出して呼ぶ形で onClick の中身をカバレッジに乗せる。
    const element = createElement(SignInButton, {
      provider: "twitter",
      callbackURL: "/posts/foo",
      label: "continue with X",
      className: "auth__provider auth__provider--x",
    });
    // SignInButton は内部 button を返すので、render 結果から onClick を取り出す代わりに
    // function 直接呼び出しでロジックを検証する: SignInButton はレンダ用 component
    // であり、props 引き受け部分の純粋ロジックは startSocialSignIn を呼ぶこと。
    // ここでは render が throw しないことを再確認 (上の test と合わせて branch coverage)。
    expect(element).not.toBeNull();
    // 直接 onClick を呼んで coverage を取るには render → onClick prop 抽出が必要。
    // 簡易には button の生成 closure が呼ばれる経路を component 自体の invoke で確保する。
    const result = (
      SignInButton({
        provider: "twitter",
        callbackURL: "/posts/foo",
        label: "continue with X",
        className: "x",
      }) as { props: { onClick: () => void } }
    ).props.onClick();
    expect(result).toBeUndefined();
    expect(mockSignInSocial).toHaveBeenCalledWith({
      provider: "twitter",
      callbackURL: "/posts/foo",
    });
  });
});
