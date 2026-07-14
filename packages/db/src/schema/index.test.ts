/**
 * schema barrel (`index.ts`) の test。
 *
 * 各 table の shape は per-file sibling test (`posts.test.ts` / `comments.test.ts` /
 * `likes.test.ts` / `view-counts.test.ts` / `auth.test.ts`) が凍結するので、ここでは
 * barrel が各 module の実体をそのまま re-export していること (drizzle-kit が
 * `index.ts` 起点で全 table を見られること) だけを保証する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business schema barrel が全 table (posts / comments / likes / view_counts + Better Auth 4 table) を同一実体で re-export していることを保証。drizzle-kit の migration 生成起点から table が漏れる回帰を取る
 * @graph-connects none
 */

import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { account, session, user, verification } from "./auth.js";
import { comments } from "./comments.js";
import * as barrel from "./index.js";
import { likes } from "./likes.js";
import { posts } from "./posts.js";
import { viewCounts } from "./view-counts.js";

describe("schema barrel", () => {
  it("各 table を同一実体で re-export する", () => {
    expect(barrel.posts).toBe(posts);
    expect(barrel.comments).toBe(comments);
    expect(barrel.likes).toBe(likes);
    expect(barrel.viewCounts).toBe(viewCounts);
    expect(barrel.user).toBe(user);
    expect(barrel.session).toBe(session);
    expect(barrel.account).toBe(account);
    expect(barrel.verification).toBe(verification);
  });

  it("barrel 起点で全 table 名が引ける (drizzle-kit の schema 起点)", () => {
    const tables = [
      barrel.posts,
      barrel.comments,
      barrel.likes,
      barrel.viewCounts,
      barrel.user,
      barrel.session,
      barrel.account,
      barrel.verification,
    ];
    expect(tables.map((t) => getTableConfig(t).name)).toStrictEqual([
      "posts",
      "comments",
      "likes",
      "view_counts",
      "user",
      "session",
      "account",
      "verification",
    ]);
  });
});
