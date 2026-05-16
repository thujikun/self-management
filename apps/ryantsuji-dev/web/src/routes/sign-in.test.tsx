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
import { Route, SignInButton, buildOnClick, isSafeRedirect, startSocialSignIn } from "./sign-in.js";

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
  it("3 つの OAuth provider ボタンが全部 render される (Apple / Facebook は未対応)", async () => {
    const html = await ssrAt("/sign-in");
    expect(html).toMatch(/<h1>sign in<\/h1>/);
    expect(html).toMatch(/Continue with GitHub/);
    expect(html).toMatch(/Continue with X/);
    expect(html).toMatch(/Continue with Google/);
    expect(html).not.toMatch(/Continue with Apple/);
    expect(html).not.toMatch(/Continue with Facebook/);
  });

  it("?redirect=/posts/foo を渡しても sign-in page は render される", async () => {
    const html = await ssrAt("/sign-in?redirect=%2Fposts%2Ffoo");
    expect(html).toMatch(/Continue with GitHub/);
  });

  it("Route export は validateSearch / component を持つ", () => {
    expect(typeof Route.options.component).toBe("function");
    expect(Route.options.validateSearch).toBeTypeOf("object");
  });
});

describe("isSafeRedirect (open redirect ガード)", () => {
  it.each([["/account"], ["/posts/foo"], ["/"], ["/x"]])("✓ %s", (input) => {
    expect(isSafeRedirect(input)).toBe(true);
  });

  it.each([
    ["//evil.com"],
    ["//evil.com/path"],
    ["/\\evil.com"], // backslash → ブラウザが `/` に正規化して protocol-relative 化
    ["/\\evil.com/path"],
    ["/%2fevil.com"], // URL-encoded slash
    ["/%2Fevil.com"], // 大小無視
    ["/%5cevil.com"], // URL-encoded backslash
    ["/%5Cevil.com"],
    ["http://evil.com"], // 絶対 URL
    ["https://evil.com"],
    ["evil.com/foo"], // path 以外
    [""],
  ])("✗ %s", (input) => {
    expect(isSafeRedirect(input)).toBe(false);
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
  it("button render に label と className が反映される", () => {
    const html = renderToString(
      createElement(SignInButton, {
        provider: "github",
        callbackURL: "/account",
        label: "Continue with GitHub",
        className: "auth__provider auth__provider--github",
      }),
    );
    expect(html).toMatch(/<button[^>]*class="auth__provider auth__provider--github"/);
    expect(html).toMatch(/Continue with GitHub/);
  });
});

describe("buildOnClick", () => {
  beforeEach(() => mockSignInSocial.mockReset());
  afterEach(() => mockSignInSocial.mockReset());

  it("provider + callbackURL を closure に焼いた handler を返す (github)", () => {
    const handler = buildOnClick("github", "/account");
    handler();
    expect(mockSignInSocial).toHaveBeenCalledWith({
      provider: "github",
      callbackURL: "/account",
    });
  });

  it("provider + callbackURL を closure に焼いた handler を返す (twitter)", () => {
    const handler = buildOnClick("twitter", "/posts/foo");
    handler();
    expect(mockSignInSocial).toHaveBeenCalledWith({
      provider: "twitter",
      callbackURL: "/posts/foo",
    });
  });
});
