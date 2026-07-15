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
  DevtoHttpError,
  fetchDevtoJson,
  flattenOwnerThreads,
  groupOwnerThreads,
  htmlToText,
  OWNER_USERNAME,
  parseArticleMeta,
  parseDevtoComments,
  parseRetryAfterMs,
  type DevtoComment,
} from "./devto-threads.js";

/** status / headers を持つ最小の Response 風 stub。 */
function res(status: number, body: unknown = {}, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

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

describe("parseRetryAfterMs", () => {
  it("秒数ヘッダを ms に変換する", () => {
    expect(parseRetryAfterMs("2", 1_000)).toBe(2_000);
    expect(parseRetryAfterMs("0", 1_000)).toBe(0);
  });

  it("HTTP-date は現在時刻との差を返す (過去なら 0)", () => {
    const now = Date.parse("2026-07-01T00:00:00Z");
    expect(parseRetryAfterMs("Wed, 01 Jul 2026 00:00:05 GMT", now)).toBe(5_000);
    expect(parseRetryAfterMs("Wed, 01 Jul 2026 00:00:00 GMT", now + 10_000)).toBe(0);
  });

  it("null / 解釈不能は null", () => {
    expect(parseRetryAfterMs(null, 0)).toBeNull();
    expect(parseRetryAfterMs("soon", 0)).toBeNull();
  });
});

describe("fetchDevtoJson (レート制限リトライ)", () => {
  const noSleep = () => Promise.resolve();

  it("200 は 1 回で JSON を返す", async () => {
    let calls = 0;
    const fetchImpl = (() => {
      calls++;
      return Promise.resolve(res(200, { ok: true }));
    }) as unknown as typeof fetch;
    const out = await fetchDevtoJson("u", "l", { fetchImpl, sleep: noSleep });
    expect(out).toEqual({ ok: true });
    expect(calls).toBe(1);
  });

  it("429 の後 200 なら Retry-After を尊重してリトライする", async () => {
    const statuses = [429, 200];
    const waits: number[] = [];
    let calls = 0;
    const fetchImpl = (() => {
      const s = statuses[calls++];
      return Promise.resolve(
        s === 429 ? res(429, {}, { "retry-after": "3" }) : res(200, { done: 1 }),
      );
    }) as unknown as typeof fetch;
    const out = await fetchDevtoJson("u", "l", {
      fetchImpl,
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    });
    expect(out).toEqual({ done: 1 });
    expect(calls).toBe(2);
    expect(waits).toEqual([3_000]); // Retry-After: 3s を採用
  });

  it("5xx が続くと retries を使い切って throw する", async () => {
    let calls = 0;
    const fetchImpl = (() => {
      calls++;
      return Promise.resolve(res(503));
    }) as unknown as typeof fetch;
    await expect(
      fetchDevtoJson("u", "a_id=1", { fetchImpl, sleep: noSleep, retries: 2 }),
    ).rejects.toThrow(/503 for a_id=1/);
    expect(calls).toBe(3); // 初回 + retries(2)
  });

  it("404 (429 以外の 4xx) は即 throw、リトライしない", async () => {
    let calls = 0;
    const fetchImpl = (() => {
      calls++;
      return Promise.resolve(res(404));
    }) as unknown as typeof fetch;
    await expect(fetchDevtoJson("u", "l", { fetchImpl, sleep: noSleep })).rejects.toThrow(/404/);
    expect(calls).toBe(1);
  });

  it("HTTP エラーは status を持つ DevtoHttpError で投げる (404 skip 判定に使える)", async () => {
    const fetchImpl = (() => Promise.resolve(res(404))) as unknown as typeof fetch;
    const err = await fetchDevtoJson("u", "a_id=4100706", { fetchImpl, sleep: noSleep }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(DevtoHttpError);
    expect((err as DevtoHttpError).status).toBe(404);
    expect((err as DevtoHttpError).label).toBe("a_id=4100706");
  });

  it("ネットワーク例外も一時障害としてリトライする", async () => {
    let calls = 0;
    const fetchImpl = (() => {
      calls++;
      if (calls === 1) return Promise.reject(new Error("network down"));
      return Promise.resolve(res(200, { recovered: true }));
    }) as unknown as typeof fetch;
    const out = await fetchDevtoJson("u", "l", { fetchImpl, sleep: noSleep });
    expect(out).toEqual({ recovered: true });
    expect(calls).toBe(2);
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

  it("削除コメント (user フィールド欠落) は throw せず placeholder に正規化する", () => {
    const raw = [
      {
        type_of: "comment",
        id_code: "del",
        created_at: "2026-05-01T00:00:00Z",
        body_html: "<p>[deleted]</p>",
        user: {}, // 投稿者削除で name/username が無い
        children: [],
      },
    ];
    const [c] = parseDevtoComments(raw);
    expect(c?.user).toStrictEqual({ name: "[deleted]", username: "" });
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

  it("削除コメント (username 空) を含むスレッドは OWNER がいても丸ごと skip する", () => {
    const deleted = {
      ...node("del", "x", "2026-05-05T00:00:00Z"),
      user: { name: "[deleted]", username: "" },
    };
    const tree = [
      {
        ...node("top", "vinicius", "2026-05-05T00:00:00Z", [deleted]),
        children: [deleted, node("mine", OWNER_USERNAME, "2026-05-05T02:00:00Z")],
      },
    ];
    expect(groupOwnerThreads(tree, ARTICLE_URL)).toEqual([]);
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
