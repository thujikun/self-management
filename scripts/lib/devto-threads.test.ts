/**
 * dev.to コメントツリーの純粋ロジック (html 化 / 本人関与スレッド抽出) の test。
 *
 * ネットワーク IO (fetch) と fs IO (readPostDevtoIds) は対象外。ここでは本文の plain 化と、
 * OWNER 関与スレッドの抽出・フラット化・時系列整列という「取り込み内容を決める」部分を固定する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business htmlToText / groupOwnerThreads / flattenOwnerThreads の純粋ロジックと、dev.to API レスポンスの境界検証 (parseDevtoComments / parseArticleMeta) を固定。本人関与スレッドだけを抽出し 1 階層フラット化 + createdAt 昇順に整列する選別規約を回帰テストで守る
 * @graph-connects none
 */

import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import {
  flattenOwnerThreads,
  groupOwnerThreads,
  htmlToText,
  OWNER_USERNAME,
  parseArticleMeta,
  parseDevtoComments,
  type DevtoComment,
} from "./devto-threads.js";

function node(
  idCode: string,
  username: string,
  createdAt: string,
  children: DevtoComment[] = [],
  bodyHtml = `<p>body ${idCode}</p>`,
): DevtoComment {
  return {
    type_of: "comment",
    id_code: idCode,
    created_at: createdAt,
    body_html: bodyHtml,
    user: { name: `${username}-name`, username },
    children,
  };
}

const ARTICLE_URL = "https://dev.to/ryantsuji/some-post-123";

describe("htmlToText", () => {
  it("タグを剥がし entity を戻し、block 境界を改行にする", () => {
    const html = "<p>Hello &amp; welcome</p><p>second &lt;line&gt;</p>";
    expect(htmlToText(html)).toBe("Hello & welcome\n\nsecond <line>");
  });

  it("<br> は単一改行、3 連以上の改行は 2 つに圧縮", () => {
    expect(htmlToText("a<br>b<br/>c")).toBe("a\nb\nc");
    expect(htmlToText("<div>x</div><div>y</div><div>z</div>")).toBe("x\n\ny\n\nz");
  });

  it("<a href> は URL を markdown link として保持する", () => {
    const html =
      '<p>see <a href="https://example.com/threat-model">this article</a> for detail</p>';
    expect(htmlToText(html)).toBe(
      "see [this article](https://example.com/threat-model) for detail",
    );
  });

  it("text と href が同一の bare link は URL 単体に畳む", () => {
    const html = '<p><a href="https://example.com/x">https://example.com/x</a></p>';
    expect(htmlToText(html)).toBe("https://example.com/x");
  });
});

describe("parseDevtoComments (境界検証)", () => {
  it("正常な shape はそのまま返す (unknown key は落とす)", () => {
    const raw = [
      {
        type_of: "comment",
        id_code: "abc",
        created_at: "2026-05-01T00:00:00Z",
        body_html: "<p>hi</p>",
        user: { name: "Vini", username: "vinimabreu", twitter_username: null },
        children: [],
        positive_reactions_count: 3,
      },
    ];
    expect(parseDevtoComments(raw)).toStrictEqual([
      {
        type_of: "comment",
        id_code: "abc",
        created_at: "2026-05-01T00:00:00Z",
        body_html: "<p>hi</p>",
        user: { name: "Vini", username: "vinimabreu" },
        children: [],
      },
    ]);
  });

  it("children 欠落は深部のクラッシュではなく境界の ZodError になる", () => {
    const raw = [
      {
        type_of: "comment",
        id_code: "abc",
        created_at: "2026-05-01T00:00:00Z",
        body_html: "<p>hi</p>",
        user: { name: "Vini", username: "vinimabreu" },
        // children なし (dev.to 側の仕様変更を想定)
      },
    ];
    expect(() => parseDevtoComments(raw)).toThrow(ZodError);
    expect(() => parseDevtoComments(raw)).toThrow(/children/);
  });

  it("配列でないレスポンス (error object 等) も ZodError で弾く", () => {
    expect(() => parseDevtoComments({ error: "not found", status: 404 })).toThrow(ZodError);
  });
});

describe("parseArticleMeta (境界検証)", () => {
  it("url + title を検証して返す", () => {
    expect(parseArticleMeta({ url: "https://dev.to/x/y", title: "T", extra: 1 }, 42)).toStrictEqual(
      { url: "https://dev.to/x/y", title: "T" },
    );
  });

  it("title 欠落は article id で代替する", () => {
    expect(parseArticleMeta({ url: "https://dev.to/x/y" }, 42)).toStrictEqual({
      url: "https://dev.to/x/y",
      title: "article 42",
    });
  });

  it("url 欠落は明示エラー、object 以外は ZodError", () => {
    expect(() => parseArticleMeta({ title: "T" }, 42)).toThrow("dev.to article 42 has no url");
    expect(() => parseArticleMeta("oops", 42)).toThrow(ZodError);
  });
});

describe("groupOwnerThreads", () => {
  it("OWNER が絡まないトップレベルスレッドは丸ごと落とす", () => {
    const tree = [
      node("t1", "stranger", "2026-05-01T00:00:00Z", [
        node("t1r1", "another", "2026-05-01T01:00:00Z"),
      ]),
    ];
    expect(groupOwnerThreads(tree, ARTICLE_URL)).toEqual([]);
  });

  it("OWNER が返信したスレッドを top + timeline (createdAt 昇順) で返す", () => {
    const tree = [
      node("top", "vinicius", "2026-05-02T00:00:00Z", [
        node("reply2", OWNER_USERNAME, "2026-05-02T03:00:00Z"),
        node("reply1", "vinicius", "2026-05-02T02:00:00Z"),
      ]),
    ];
    const groups = groupOwnerThreads(tree, ARTICLE_URL);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.top.sourceCommentId).toBe("top");
    // timeline は top を含み createdAt 昇順
    expect(groups[0]?.timeline.map((c) => c.sourceCommentId)).toEqual(["top", "reply1", "reply2"]);
    // 深い nest も所属トップレベルへの reply に畳む (parentSourceId = 'top')
    expect(groups[0]?.timeline[2]?.parentSourceId).toBe("top");
    expect(groups[0]?.timeline[0]?.parentSourceId).toBeNull();
  });

  it("attribution (profileUrl / sourceUrl / isOwner) を付与する", () => {
    const tree = [
      node("top", "vinicius", "2026-05-02T00:00:00Z", [
        node("mine", OWNER_USERNAME, "2026-05-02T01:00:00Z"),
      ]),
    ];
    const [group] = groupOwnerThreads(tree, ARTICLE_URL);
    expect(group?.top.authorProfileUrl).toBe("https://dev.to/vinicius");
    expect(group?.top.sourceUrl).toBe(`${ARTICLE_URL}/comments/#comment-top`);
    expect(group?.top.isOwner).toBe(false);
    expect(group?.timeline.find((c) => c.sourceCommentId === "mine")?.isOwner).toBe(true);
  });

  it("孫コメント (OWNER が深い階層で反応) でもスレッドを拾う", () => {
    const tree = [
      node("top", "vinicius", "2026-05-03T00:00:00Z", [
        node("child", "mike", "2026-05-03T01:00:00Z", [
          node("grand", OWNER_USERNAME, "2026-05-03T02:00:00Z"),
        ]),
      ]),
    ];
    const groups = groupOwnerThreads(tree, ARTICLE_URL);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.timeline.map((c) => c.sourceCommentId)).toEqual(["top", "child", "grand"]);
  });
});

describe("flattenOwnerThreads", () => {
  it("全スレッドの timeline を連結したフラット配列を返す", () => {
    const tree = [
      node("a", "vinicius", "2026-05-04T00:00:00Z", [
        node("a-mine", OWNER_USERNAME, "2026-05-04T01:00:00Z"),
      ]),
      node("b", "stranger", "2026-05-04T02:00:00Z"), // OWNER 不在 → 落ちる
      node("c", "mike", "2026-05-04T03:00:00Z", [
        node("c-mine", OWNER_USERNAME, "2026-05-04T04:00:00Z"),
      ]),
    ];
    const flat = flattenOwnerThreads(tree, ARTICLE_URL);
    expect(flat.map((c) => c.sourceCommentId)).toEqual(["a", "a-mine", "c", "c-mine"]);
  });
});
