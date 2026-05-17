/**
 * `/` (landing) の server-only loader `runLanding` の test。
 *
 * `listPosts` を vi.mock で固定し、includeDrafts pass-through を網羅する。実 content
 * の latest 3 件取り出しは `posts.ts` の listPosts test で別途検証済 (本 test では
 * pass-through 信号だけ確認)。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business runLanding が listPosts に includeDrafts を pass-through し、latest 3 件 slice を返すことを確認。lang 解決の根は pickLang test に委譲、ここは loader 結線のみを test
 * @graph-connects none
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../server/posts.js", async () => {
  const actual = await vi.importActual<typeof import("../server/posts.js")>("../server/posts.js");
  return {
    ...actual,
    listPosts: vi.fn(() => []),
  };
});
vi.mock("../server/request.server.js", () => ({
  safeAcceptLanguage: () => null,
  safeCookieLang: () => null,
}));

const { listPosts } = await import("../server/posts.js");
const { runLanding } = await import("./index.server.js");

const mockListPosts = vi.mocked(listPosts);

beforeEach(() => {
  mockListPosts.mockReset();
  mockListPosts.mockReturnValue([]);
});

describe("runLanding", () => {
  it("default では listPosts に includeDrafts: false を渡す", () => {
    runLanding();
    expect(mockListPosts).toHaveBeenCalledWith("en", { includeDrafts: false });
  });

  it("includeDrafts: true で admin preview 経路に立つ", () => {
    runLanding({ includeDrafts: true });
    expect(mockListPosts).toHaveBeenCalledWith("en", { includeDrafts: true });
  });

  it("latest は 3 件で slice する", () => {
    mockListPosts.mockReturnValue(
      Array.from({ length: 5 }, (_, i) => ({
        slug: `s${i}`,
        lang: "en",
        title: `t${i}`,
        publishedAt: `2026-01-0${i + 1}`,
        tags: [],
        draft: false,
        syndication: {},
        availableLangs: ["en"],
        servedLang: "en",
      })),
    );
    const out = runLanding();
    expect(out.latest).toHaveLength(3);
  });
});
