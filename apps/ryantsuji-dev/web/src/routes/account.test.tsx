/**
 * `/account` route の SSR + sign-out handler test。
 *
 * `useSession` を mock して 3 状態 (pending / 未認証 / 認証済) を SSR 検証 +
 * 切り出した `endSession()` を直接呼んで `signOut` 委譲を確認。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business account route の 3 状態 (pending / 未認証 / 認証済) を useSession mock で SSR 検証 + endSession を直接 invoke して signOut 委譲を保証。本物の HTTP 経路は browser E2E で扱う
 * @graph-connects none
 */

import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getRouter } from "../router.js";
import { endSession } from "./account.js";

const mockUseSession = vi.fn();
const mockSignOut = vi.fn();
vi.mock("../lib/auth-client.js", () => ({
  authClient: {},
  signIn: { social: vi.fn() },
  signOut: () => mockSignOut(),
  useSession: () => mockUseSession(),
}));

async function ssrAccount(): Promise<string> {
  const router = getRouter({
    history: createMemoryHistory({ initialEntries: ["/account"] }),
  });
  await router.load();
  return renderToString(<RouterProvider router={router} />);
}

describe("/account", () => {
  beforeEach(() => {
    mockUseSession.mockReset();
    mockSignOut.mockReset();
  });
  afterEach(() => {
    mockUseSession.mockReset();
    mockSignOut.mockReset();
  });

  it("session pending → 'checking session...' を表示", async () => {
    mockUseSession.mockReturnValue({ data: null, isPending: true });
    const html = await ssrAccount();
    expect(html).toMatch(/checking session\.\.\./);
  });

  it("未認証 → sign-in リンクを表示 (?redirect=/account 付き)", async () => {
    mockUseSession.mockReturnValue({ data: null, isPending: false });
    const html = await ssrAccount();
    expect(html).toMatch(/<h1>not signed in<\/h1>/);
    expect(html).toMatch(/href="\/sign-in\?redirect=%2Faccount"/);
  });

  it("認証済 → user.name / email + sign-out を表示", async () => {
    mockUseSession.mockReturnValue({
      data: { user: { name: "Ryan Tsuji", email: "ryan@example.com" } },
      isPending: false,
    });
    const html = await ssrAccount();
    expect(html).toMatch(/<h1>account<\/h1>/);
    expect(html).toMatch(/Ryan Tsuji/);
    expect(html).toMatch(/ryan@example\.com/);
    expect(html).toMatch(/sign out/);
  });
});

describe("endSession", () => {
  beforeEach(() => mockSignOut.mockReset());
  afterEach(() => mockSignOut.mockReset());

  it("signOut を呼ぶ薄い wrapper", () => {
    endSession();
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });
});
